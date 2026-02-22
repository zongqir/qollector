use std::sync::LazyLock;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent("PasteHarbor/1.0")
        .pool_max_idle_per_host(5)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

pub fn client() -> &'static reqwest::Client {
    &HTTP_CLIENT
}
