"""File storage: Cloudflare R2 (S3-compatible) when configured, local disk otherwise."""
import os
from pathlib import Path

from .config import R2_BUCKET, R2_ENDPOINT, R2_KEY, R2_SECRET

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


def put(key: str, data: bytes, content_type: str) -> None:
    if R2_ENDPOINT:
        client().put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type)
        return
    base_dir = Path(os.environ.get("LOCAL_STORAGE_DIR", str(LOCAL_DIR)))
    path = (base_dir / key).resolve()
    if base_dir.resolve() not in path.parents:
        raise ValueError("invalid storage key")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
