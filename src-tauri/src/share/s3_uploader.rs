use crate::share::config::S3Config;
use crate::share::ShareError;
use s3::creds::Credentials;
use s3::Bucket;
use s3::Region;

fn make_bucket(config: &S3Config) -> Result<Bucket, ShareError> {
    let region = Region::Custom {
        region: config.region.clone(),
        endpoint: config.endpoint.clone(),
    };
    let credentials = Credentials::new(
        Some(&config.access_key),
        Some(&config.secret_key),
        None,
        None,
        None,
    )
    .map_err(|e| ShareError::S3(e.to_string()))?;

    let bucket = Bucket::new(&config.bucket, region, credentials)
        .map_err(|e| ShareError::S3(e.to_string()))?
        .with_path_style();

    Ok(*bucket)
}

/// Upload content to S3-compatible storage and return the public URL.
pub async fn upload_to_s3(
    content: &[u8],
    filename: &str,
    config: &S3Config,
) -> Result<String, ShareError> {
    let bucket = make_bucket(config)?;

    let date = chrono::Utc::now().format("%Y%m%d").to_string();
    let id = uuid::Uuid::new_v4();
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let path = format!("qollect/{}/{}.{}", date, id, ext);

    let resp = bucket
        .put_object(&path, content)
        .await
        .map_err(|e| ShareError::S3(e.to_string()))?;

    if resp.status_code() < 200 || resp.status_code() >= 300 {
        return Err(ShareError::S3(format!(
            "S3 upload returned status {}",
            resp.status_code()
        )));
    }

    let url = if let Some(domain) = &config.custom_domain {
        let domain = domain.trim_end_matches('/');
        format!("{}/{}", domain, path)
    } else {
        let endpoint = config.endpoint.trim_end_matches('/');
        format!("{}/{}/{}", endpoint, config.bucket, path)
    };

    Ok(url)
}

/// Test S3 connectivity by uploading and deleting a small test file.
pub async fn test_s3_connection(config: &S3Config) -> Result<(), ShareError> {
    let bucket = make_bucket(config)?;
    let test_path = "qollect/.connection-test";
    let test_content = b"qollect-connection-test";

    bucket
        .put_object(test_path, test_content)
        .await
        .map_err(|e| ShareError::S3(format!("Upload test failed: {}", e)))?;

    bucket
        .delete_object(test_path)
        .await
        .map_err(|e| ShareError::S3(format!("Delete test failed: {}", e)))?;

    Ok(())
}
