FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /out/edge-ingest .

FROM gcr.io/distroless/static
COPY --from=build /out/edge-ingest /edge-ingest
EXPOSE 8080
ENTRYPOINT ["/edge-ingest"]
