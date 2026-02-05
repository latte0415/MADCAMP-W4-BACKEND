from __future__ import annotations

import os
from typing import BinaryIO, Optional

import boto3

S3_BUCKET = os.environ.get("S3_BUCKET", "")
if not S3_BUCKET:
    raise RuntimeError("S3_BUCKET is not set")

S3_REGION = os.environ.get("AWS_REGION", "")
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL")

_session = boto3.session.Session(region_name=S3_REGION or None)
_s3 = _session.client("s3", endpoint_url=S3_ENDPOINT_URL)


def upload_fileobj(fileobj: BinaryIO, key: str, content_type: Optional[str] = None) -> str:
    extra = {}
    if content_type:
        extra["ContentType"] = content_type
    _s3.upload_fileobj(fileobj, S3_BUCKET, key, ExtraArgs=extra or None)
    return key


def upload_file(path: str, key: str, content_type: Optional[str] = None) -> str:
    extra = {}
    if content_type:
        extra["ContentType"] = content_type
    _s3.upload_file(path, S3_BUCKET, key, ExtraArgs=extra or None)
    return key


def download_fileobj(key: str, fileobj: BinaryIO) -> None:
    _s3.download_fileobj(S3_BUCKET, key, fileobj)


def presign_get_url(key: str, expires_in: int = 3600) -> str:
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )


def presign_put_url(key: str, content_type: Optional[str] = None, expires_in: int = 3600) -> str:
    params = {"Bucket": S3_BUCKET, "Key": key}
    if content_type:
        params["ContentType"] = content_type
    return _s3.generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def delete_key(key: str) -> None:
    _s3.delete_object(Bucket=S3_BUCKET, Key=key)


def delete_keys(keys: list[str]) -> None:
    if not keys:
        return
    _s3.delete_objects(
        Bucket=S3_BUCKET,
        Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
    )
