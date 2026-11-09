// Edge ingest: accepts files and JSON events with bounded concurrency,
// then forwards files to the Intelligence service. Starting point for MQTT/OPC-UA adapters.
package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

var (
	intelligenceURL = env("INTELLIGENCE_URL", "http://localhost:8001")
	edgeKey         = env("EDGE_API_KEY", os.Getenv("API_KEY"))
	sem             = make(chan struct{}, 32) // max concurrent forwards
	client          = &http.Client{Timeout: 120 * time.Second}
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "edge-ingest"})
}

// POST /ingest/file  (multipart: file, tenant_id)
func ingestFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	select {
	case sem <- struct{}{}:
		defer func() { <-sem }()
	default:
		http.Error(w, "busy, retry", http.StatusTooManyRequests)
		return
	}
	auth := r.Header.Get("Authorization")
	if auth == "" {
		http.Error(w, "missing bearer token", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
	file, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", hdr.Filename)
	if _, err := io.Copy(part, file); err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	mw.Close()

	// The caller's bearer token is forwarded; the Intelligence service validates it and scopes the data to its tenant.
	req, err := http.NewRequest(http.MethodPost, intelligenceURL+"/v1/documents", &buf)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", auth)
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// POST /ingest/event  (JSON sensor/event payload). Buffered stub: wire to NATS/Redis later.
func ingestEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Machines authenticate with a shared key until per-device credentials exist.
	if edgeKey == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-API-Key")), []byte(edgeKey)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var ev map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&ev); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	log.Printf("event received keys=%d", len(ev))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]any{"accepted": true})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/ingest/file", ingestFile)
	mux.HandleFunc("/ingest/event", ingestEvent)
	addr := ":" + env("PORT", "8080")
	log.Printf("cawrys edge-ingest listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
