"""Persistent storage abstraction layer supporting Local and Neon Object Storage."""
import abc
from dataclasses import dataclass
import datetime
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
from typing import Any, BinaryIO, Iterator, List, Optional, Union

import botocore.config
import botocore.exceptions
from botocore.exceptions import ClientError

from .config import R2_BUCKET, R2_ENDPOINT, R2_KEY, R2_SECRET

PERSISTENCE_MODE_FILE = "/tmp/liontix_persistence_mode.json"


@dataclass
class StorageObjectMetadata:
    """Metadata for an object stored in local or object storage."""
    key: str
    size: int
    content_type: str = "application/octet-stream"
    last_modified: Optional[datetime.datetime] = None
    etag: Optional[str] = None


class BaseStorageProvider(abc.ABC):
    """Abstract base class for persistent storage providers."""

    @abc.abstractmethod
    def put(
        self,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
    ) -> StorageObjectMetadata:
        """Stores object data under the given key."""
        raise NotImplementedError

    @abc.abstractmethod
    def get(self, key: str) -> Optional[bytes]:
        """Retrieves raw object bytes for key, or None if not found."""
        raise NotImplementedError

    @abc.abstractmethod
    def get_stream(
        self, key: str, chunk_size: int = 65536
    ) -> Optional[Iterator[bytes]]:
        """Retrieves chunked byte stream generator for key, or None if not found."""
        raise NotImplementedError

    @abc.abstractmethod
    def delete(self, key: str) -> bool:
        """Deletes object for key. Returns True if deleted, False if non-existent or failed."""
        raise NotImplementedError

    @abc.abstractmethod
    def exists(self, key: str) -> bool:
        """Returns True if object exists for key, False otherwise."""
        raise NotImplementedError

    @abc.abstractmethod
    def list(
        self, prefix: str = "", limit: int = 100
    ) -> List[StorageObjectMetadata]:
        """Lists metadata for stored objects matching prefix."""
        raise NotImplementedError

    @abc.abstractmethod
    def get_metadata(self, key: str) -> Optional[StorageObjectMetadata]:
        """Retrieves metadata for key without loading the entire body."""
        raise NotImplementedError


def _get_default_local_upload_dir() -> Path:
    env_dir = os.environ.get("LOCAL_STORAGE_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    repo_root = Path(__file__).resolve().parents[3]
    return (repo_root / "uploaded_pdfs").resolve()


def _default_storage_dir() -> Path:
    env_dir = os.environ.get("LOCAL_STORAGE_DIR")
    if env_dir:
        return Path(env_dir)
    data_dir = Path("/data/files")
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    except (PermissionError, OSError):
        pass
    fallback = Path("./data/files")
    try:
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback.resolve()
    except (PermissionError, OSError):
        tmp = Path("/tmp/cawrys_files")
        tmp.mkdir(parents=True, exist_ok=True)
        return tmp


LOCAL_DIR = _default_storage_dir()
_client = None


def client():
    """Legacy boto3 S3 client provider for backward compatibility."""
    global _client
    if _client is None:
        import boto3

        _client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_KEY or None,
            aws_secret_access_key=R2_SECRET or None,
            region_name="auto",
        )
    return _client


class LocalStorageProvider(BaseStorageProvider):
    """Local filesystem storage provider anchored to uploaded_pdfs directory."""

    def __init__(self, base_dir: Optional[Union[str, Path]] = None):
        if base_dir:
            self.base_dir = Path(base_dir).resolve()
        else:
            self.base_dir = _get_default_local_upload_dir()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, key: str) -> Path:
        """Resolves target file path and strictly enforces path traversal boundaries."""
        if not key or not isinstance(key, str):
            raise ValueError("invalid storage key: key must be a non-empty string")
        if "\x00" in key:
            raise ValueError("invalid storage key: embedded null byte detected")
        if re.search(r"[\ud800-\udfff]", key):
            raise ValueError("invalid storage key: unicode surrogate detected")
        if key.startswith("/") or key.startswith("\\"):
            raise ValueError("invalid storage key: absolute paths forbidden")

        try:
            resolved = (self.base_dir / key).resolve()
        except Exception as exc:
            raise ValueError(f"invalid storage key: {exc}")

        if not resolved.is_relative_to(self.base_dir):
            raise ValueError("invalid storage key: path traversal escape detected")
        if resolved == self.base_dir:
            raise ValueError("invalid storage key: cannot reference root storage directory")
        return resolved

    def _find_file_path(self, key: str) -> Optional[Path]:
        """Resolves file path in base_dir or legacy candidate locations."""
        try:
            target = self._resolve_path(key)
            if target.is_file():
                return target
        except ValueError:
            return None

        legacy_candidates = [
            Path("./data/files").resolve(),
            Path("/data/files"),
            Path("/tmp/cawrys_files"),
        ]
        for base in legacy_candidates:
            try:
                cand_res = base.resolve()
                p = (cand_res / key).resolve()
                if p.is_relative_to(cand_res) and p.is_file():
                    return p
            except Exception:
                continue
        return None

    def put(
        self,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
    ) -> StorageObjectMetadata:
        target = self._resolve_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(data, (bytes, bytearray)):
            byte_content = bytes(data)
        elif hasattr(data, "read"):
            byte_content = data.read()
        else:
            raise ValueError("invalid data payload: must be bytes or binary stream")

        target.write_bytes(byte_content)
        size = len(byte_content)
        etag = hashlib.md5(byte_content).hexdigest()
        now = datetime.datetime.now(datetime.timezone.utc)

        if content_type == "application/octet-stream":
            guessed, _ = mimetypes.guess_type(target.name)
            if guessed:
                content_type = guessed

        return StorageObjectMetadata(
            key=key,
            size=size,
            content_type=content_type,
            last_modified=now,
            etag=etag,
        )

    def get(self, key: str) -> Optional[bytes]:
        if not key or key.startswith("local-unstored/"):
            return None
        path = self._find_file_path(key)
        if path and path.is_file():
            return path.read_bytes()
        return None

    def get_stream(
        self, key: str, chunk_size: int = 65536
    ) -> Optional[Iterator[bytes]]:
        if not key or key.startswith("local-unstored/"):
            return None
        path = self._find_file_path(key)
        if not path or not path.is_file():
            return None

        def _generator() -> Iterator[bytes]:
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk

        return _generator()

    def delete(self, key: str) -> bool:
        if not key or key.startswith("local-unstored/"):
            return False
        try:
            target = self._resolve_path(key)
            if target.is_file():
                target.unlink()
                return True
            path = self._find_file_path(key)
            if path and path.is_file():
                path.unlink()
                return True
        except ValueError:
            return False
        return False

    def exists(self, key: str) -> bool:
        if not key or key.startswith("local-unstored/"):
            return False
        try:
            target = self._resolve_path(key)
            if target.is_file():
                return True
        except ValueError:
            return False
        return self._find_file_path(key) is not None

    def get_metadata(self, key: str) -> Optional[StorageObjectMetadata]:
        if not key or key.startswith("local-unstored/"):
            return None
        path = self._find_file_path(key)
        if not path or not path.is_file():
            return None
        stat = path.stat()
        mtime = datetime.datetime.fromtimestamp(stat.st_mtime, tz=datetime.timezone.utc)
        mime, _ = mimetypes.guess_type(path.name)
        return StorageObjectMetadata(
            key=key,
            size=stat.st_size,
            content_type=mime or "application/octet-stream",
            last_modified=mtime,
            etag=None,
        )

    def list(
        self, prefix: str = "", limit: int = 100
    ) -> List[StorageObjectMetadata]:
        results: List[StorageObjectMetadata] = []
        if not self.base_dir.exists():
            return results
        norm_prefix = prefix.strip().lstrip("/")
        for root, _, files in os.walk(self.base_dir):
            for f in sorted(files):
                full_path = Path(root) / f
                rel_key = str(full_path.relative_to(self.base_dir)).replace("\\", "/")
                if norm_prefix and not rel_key.startswith(norm_prefix):
                    continue
                meta = self.get_metadata(rel_key)
                if meta:
                    results.append(meta)
                    if len(results) >= limit:
                        return results
        return results


class NeonObjectStorageProvider(BaseStorageProvider):
    """Neon Object Storage provider using path-style S3 addressing with boto3."""

    def __init__(self, bucket: Optional[str] = None, client: Optional[Any] = None):
        self._client = client
        self.bucket = (
            bucket
            or os.environ.get("NEON_STORAGE_BUCKET")
            or os.environ.get("R2_BUCKET")
            or "cawrys-files"
        )

    def _get_client(self):
        if self._client is not None:
            return self._client
        import boto3

        endpoint = os.environ.get("AWS_ENDPOINT_URL_S3") or os.environ.get("R2_ENDPOINT")
        key_id = os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("R2_KEY")
        secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY") or os.environ.get("R2_SECRET")
        region = os.environ.get("AWS_REGION") or "us-east-2"

        cfg = botocore.config.Config(s3={"addressing_style": "path"}, signature_version="s3v4")
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=cfg,
        )
        return self._client

    def _validate_key(self, key: str) -> None:
        if not key or not isinstance(key, str):
            raise ValueError("invalid storage key: key must be a non-empty string")
        if "\x00" in key:
            raise ValueError("invalid storage key: embedded null byte detected")
        if re.search(r"[\ud800-\udfff]", key):
            raise ValueError("invalid storage key: unicode surrogate detected")
        if (
            key.startswith("/")
            or key.startswith("\\")
            or "../" in key
            or "..\\" in key
            or key == ".."
            or key.endswith("/..")
        ):
            raise ValueError("invalid storage key: path traversal attempt")

    def put(
        self,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
    ) -> StorageObjectMetadata:
        self._validate_key(key)
        s3 = self._get_client()

        if isinstance(data, (bytes, bytearray)):
            body = bytes(data)
        elif hasattr(data, "read"):
            body = data.read()
        else:
            raise ValueError("invalid data payload: must be bytes or binary stream")

        s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        etag = hashlib.md5(body).hexdigest()
        now = datetime.datetime.now(datetime.timezone.utc)
        return StorageObjectMetadata(
            key=key,
            size=len(body),
            content_type=content_type,
            last_modified=now,
            etag=etag,
        )

    def get(self, key: str) -> Optional[bytes]:
        if not key or key.startswith("local-unstored/"):
            return None
        try:
            s3 = self._get_client()
            obj = s3.get_object(Bucket=self.bucket, Key=key)
            body = obj["Body"]
            if hasattr(body, "read"):
                return body.read()
            return bytes(body)
        except ClientError as exc:
            err_code = exc.response.get("Error", {}).get("Code", "")
            status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if err_code in ("NoSuchKey", "404", "NotFound") or status_code == 404:
                return None
            raise
        except botocore.exceptions.BotoCoreError:
            return None

    def get_stream(
        self, key: str, chunk_size: int = 65536
    ) -> Optional[Iterator[bytes]]:
        if not key or key.startswith("local-unstored/"):
            return None
        try:
            s3 = self._get_client()
            obj = s3.get_object(Bucket=self.bucket, Key=key)
            body = obj["Body"]

            def _stream_gen() -> Iterator[bytes]:
                if hasattr(body, "iter_chunks"):
                    yield from body.iter_chunks(chunk_size=chunk_size)
                elif hasattr(body, "read"):
                    while True:
                        chunk = body.read(chunk_size)
                        if not chunk:
                            break
                        yield chunk
                else:
                    raw = bytes(body)
                    for i in range(0, len(raw), chunk_size):
                        yield raw[i : i + chunk_size]

            return _stream_gen()
        except ClientError as exc:
            err_code = exc.response.get("Error", {}).get("Code", "")
            status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if err_code in ("NoSuchKey", "404", "NotFound") or status_code == 404:
                return None
            raise
        except botocore.exceptions.BotoCoreError:
            return None

    def delete(self, key: str) -> bool:
        if not key or key.startswith("local-unstored/"):
            return False
        try:
            s3 = self._get_client()
            s3.delete_object(Bucket=self.bucket, Key=key)
            return True
        except (ClientError, botocore.exceptions.BotoCoreError):
            return False

    def exists(self, key: str) -> bool:
        if not key or key.startswith("local-unstored/"):
            return False
        try:
            s3 = self._get_client()
            s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except (ClientError, botocore.exceptions.BotoCoreError):
            return False

    def list(
        self, prefix: str = "", limit: int = 100
    ) -> List[StorageObjectMetadata]:
        s3 = self._get_client()
        params = {"Bucket": self.bucket}
        if prefix:
            params["Prefix"] = prefix
        resp = s3.list_objects_v2(**params)
        contents = resp.get("Contents", [])
        results: List[StorageObjectMetadata] = []
        for item in contents[:limit]:
            results.append(
                StorageObjectMetadata(
                    key=item["Key"],
                    size=item.get("Size", 0),
                    last_modified=item.get("LastModified"),
                    etag=item.get("ETag", "").strip('"') if item.get("ETag") else None,
                )
            )
        return results

    def get_metadata(self, key: str) -> Optional[StorageObjectMetadata]:
        if not key or key.startswith("local-unstored/"):
            return None
        try:
            s3 = self._get_client()
            res = s3.head_object(Bucket=self.bucket, Key=key)
            return StorageObjectMetadata(
                key=key,
                size=res.get("ContentLength", 0),
                content_type=res.get("ContentType", "application/octet-stream"),
                last_modified=res.get("LastModified"),
                etag=res.get("ETag", "").strip('"') if res.get("ETag") else None,
            )
        except (ClientError, botocore.exceptions.BotoCoreError):
            return None


def get_persistence_mode() -> str:
    """Reads active persistence mode from state file; defaults to 'local'."""
    if os.path.exists(PERSISTENCE_MODE_FILE):
        try:
            with open(PERSISTENCE_MODE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return str(data.get("mode", "local")).strip().lower()
        except Exception:
            return "local"
    return "local"


def set_persistence_mode(mode: str) -> dict:
    """Validates and updates active persistence mode configuration."""
    if not isinstance(mode, str):
        raise ValueError(f"Invalid persistence mode: {mode}. Must be 'local' or 'neon'")
    norm = mode.strip().lower()
    if norm not in ("local", "neon"):
        raise ValueError(f"Invalid persistence mode: {mode}. Must be 'local' or 'neon'")
    payload = {
        "mode": norm,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "storage": "local" if norm == "local" else "neon",
        "db": "sqlite" if norm == "local" else "postgres",
    }
    tmp_path = f"{PERSISTENCE_MODE_FILE}.tmp.{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp_path, PERSISTENCE_MODE_FILE)
    return payload


def get_storage() -> BaseStorageProvider:
    """Dynamically resolves storage provider based on active persistence mode."""
    mode = get_persistence_mode()
    if mode == "neon":
        try:
            return NeonObjectStorageProvider()
        except Exception:
            return LocalStorageProvider()
    return LocalStorageProvider()


def put(
    key: str,
    data: Union[bytes, BinaryIO],
    content_type: str = "application/octet-stream",
) -> StorageObjectMetadata:
    """Stores object data using the active storage provider."""
    return get_storage().put(key, data, content_type)


def get(key: str) -> Optional[bytes]:
    """Retrieves raw bytes using active provider with fallback to local storage."""
    provider = get_storage()
    try:
        res = provider.get(key)
    except Exception:
        res = None
    if res is None and not isinstance(provider, LocalStorageProvider):
        res = LocalStorageProvider().get(key)
    return res


def get_stream(key: str, chunk_size: int = 65536) -> Optional[Iterator[bytes]]:
    """Retrieves chunked byte stream using active provider with fallback to local storage."""
    provider = get_storage()
    try:
        stream = provider.get_stream(key, chunk_size=chunk_size)
    except Exception:
        stream = None
    if stream is None and not isinstance(provider, LocalStorageProvider):
        stream = LocalStorageProvider().get_stream(key, chunk_size=chunk_size)
    return stream


def delete(key: str) -> bool:
    """Deletes object using active storage provider."""
    return get_storage().delete(key)


def exists(key: str) -> bool:
    """Checks object existence using active storage provider."""
    return get_storage().exists(key)


def list_objects(prefix: str = "", limit: int = 100) -> List[StorageObjectMetadata]:
    """Lists objects using active storage provider."""
    return get_storage().list(prefix=prefix, limit=limit)


def get_metadata(key: str) -> Optional[StorageObjectMetadata]:
    """Retrieves metadata using active storage provider."""
    return get_storage().get_metadata(key)
