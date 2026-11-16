//! Capability presets for well-known API vendors.
//!
//! A provider added with a known vendor's base URL gets that vendor's
//! capability metadata prefilled, so the console, CLI and `/config`
//! show what the vendor takes without the user spelling it out. An
//! explicitly supplied capabilities object always wins, an existing
//! provider's customized metadata is never overwritten, and a preset
//! never fails validation: when the preset's protocol list does not
//! hold the configured protocol, the list stays empty (only the
//! configured protocol is known) while the vendor's streaming, tools
//! and vision answers still apply. Capability metadata is management/UI
//! information and proves no live vendor probe, except an explicit
//! `vision: false`: a text-only member is never sent image bytes (a
//! current user image is refused, older and tool-returned images go on
//! as an omission note).

use crate::config::{Protocol, ProviderCapabilities};

/// A known vendor: the host its base URL is served from, the wire
/// protocols it takes, and whether it streams, takes tools and takes
/// image input. `None` means unknown, not unsupported.
struct Preset {
    host: &'static str,
    protocols: &'static [Protocol],
    streaming: Option<bool>,
    tools: Option<bool>,
    vision: Option<bool>,
}

// Only vendors whose answers are certain belong here. A relay or a
// niche vendor keeps unknown metadata until the user or a probe says
// otherwise.
const PRESETS: &[Preset] = &[
    Preset {
        host: "api.openai.com",
        protocols: &[Protocol::Chat, Protocol::Responses],
        streaming: Some(true),
        tools: Some(true),
        vision: Some(true),
    },
    Preset {
        host: "api.anthropic.com",
        protocols: &[Protocol::Anthropic],
        streaming: Some(true),
        tools: Some(true),
        vision: Some(true),
    },
    Preset {
        host: "api.deepseek.com",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: Some(false),
    },
    Preset {
        host: "api.moonshot.ai",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    Preset {
        host: "api.moonshot.cn",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    Preset {
        host: "generativelanguage.googleapis.com",
        protocols: &[Protocol::Gemini],
        streaming: Some(true),
        tools: Some(true),
        vision: Some(true),
    },
    Preset {
        host: "api.x.ai",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    Preset {
        host: "openrouter.ai",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    Preset {
        host: "api.groq.com",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    Preset {
        host: "api.siliconflow.cn",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: Some(true),
        vision: None,
    },
    // The Cline API speaks OpenAI Chat Completions (the reference's
    // `clinepass` preset, `Chat: "https://api.cline.bot/api/v1"`) and
    // answers streamed asks (its probe asks streamed). Tools and image
    // input are unconfirmed, so they stay unknown rather than guessed.
    Preset {
        host: "api.cline.bot",
        protocols: &[Protocol::Chat],
        streaming: Some(true),
        tools: None,
        vision: None,
    },
];

/// The host a base URL is served from, lowercased, without port or
/// trailing dot: `HTTPS://API.OPENAI.COM:443/v1` becomes
/// `api.openai.com`. Anything unparsable comes back as written, which
/// matches no preset.
fn host_of(base_url: &str) -> String {
    let after_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    let authority = after_scheme.split('/').next().unwrap_or("");
    let host = if let Some(rest) = authority.strip_prefix('[') {
        // An IPv6 literal, `[::1]` or `[::1]:8080`: never a preset.
        rest.split_once(']')
            .map(|(inside, _)| format!("[{inside}]"))
            .unwrap_or_else(|| authority.to_owned())
    } else {
        authority
            .split_once(':')
            .map(|(host, _)| host)
            .unwrap_or(authority)
            .to_owned()
    };
    host.strip_suffix('.').unwrap_or(&host).to_lowercase()
}

fn preset_for_host(host: &str) -> Option<&'static Preset> {
    if let Some(found) = PRESETS.iter().find(|preset| preset.host == host) {
        return Some(found);
    }
    // Azure OpenAI serves every customer from its own subdomain.
    const AZURE: Preset = Preset {
        host: ".openai.azure.com",
        protocols: &[Protocol::Chat, Protocol::Responses],
        streaming: Some(true),
        tools: Some(true),
        vision: Some(true),
    };
    if host.ends_with(".openai.azure.com") {
        return Some(&AZURE);
    }
    None
}

/// The capability metadata a known vendor's base URL implies for a
/// provider speaking `protocol`, or `None` when the host is unknown.
/// The protocol list holds the vendor's list only when it holds the
/// configured protocol; otherwise it stays empty, which validation
/// accepts.
pub fn preset_capabilities(base_url: &str, protocol: Protocol) -> Option<ProviderCapabilities> {
    let preset = preset_for_host(&host_of(base_url))?;
    let supported_protocols = if preset.protocols.contains(&protocol) {
        preset.protocols.to_vec()
    } else {
        Vec::new()
    };
    Some(ProviderCapabilities {
        supported_protocols,
        streaming: preset.streaming,
        tools: preset.tools,
        vision: preset.vision,
    })
}

/// The capabilities a provider add should store: an existing
/// provider's customized metadata stays untouched, a fresh or
/// never-customized provider gets its vendor's preset when known,
/// otherwise the all-unknown default.
pub fn capabilities_for_add(
    existing: Option<&ProviderCapabilities>,
    base_url: &str,
    protocol: Protocol,
) -> ProviderCapabilities {
    if let Some(known) = existing.filter(|c| **c != ProviderCapabilities::default()) {
        return (*known).clone();
    }
    preset_capabilities(base_url, protocol).unwrap_or_default()
}

/// Add-sheet partitions, mirroring the reference console: makers' own
/// APIs, one-key relays, and servers on this machine. Partners (paid
/// listings) partition the same way; the catalog holds none by
/// default, and an empty partition renders no section.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VendorKind {
    Partner,
    Vendor,
    Relay,
    Local,
}

/// One tile of the console's Add sheet: the display name, the default
/// base URL per wire protocol, and the protocol a fresh draft takes.
/// `pair` links a vendor's global and China endpoints so the sheet
/// renders them as one tile, like the reference's `id`/`id-cn` rows.
#[derive(serde::Serialize)]
pub struct VendorPreset {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short: Option<&'static str>,
    pub kind: VendorKind,
    /// Default protocol: `chat`, `responses`, `anthropic` or `gemini`.
    pub protocol: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gemini: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pair: Option<&'static str>,
    /// Where the console's `Get a key` link goes, mirroring the
    /// reference: vendors without a stable key page leave this empty
    /// and the link stays hidden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys_url: Option<&'static str>,
}

/// The logo file served for a vendor id, vendored from the reference
/// console's icon set (`-color` files are full-color pictures, the rest
/// are single-tone marks). Vendors without a collected mark get `None`
/// and the console falls back to an initial avatar.
pub fn vendor_icon(id: &str) -> Option<&'static str> {
    Some(match id {
        "openai" => "openai.svg",
        "anthropic" => "anthropic.svg",
        "gemini" => "gemini-color.svg",
        "deepseek" => "deepseek-color.svg",
        "moonshot" | "moonshot-cn" => "moonshot.svg",
        "qwen" => "qwen-color.svg",
        "zhipu" | "zhipu-cn" => "zhipu-color.svg",
        "doubao" => "doubao-color.svg",
        "minimax" | "minimax-cn" => "minimax-color.svg",
        "baidu" => "baidu-color.svg",
        "tencent" => "hunyuan-color.svg",
        "xunfei" => "spark-color.svg",
        "stepfun" => "stepfun-color.svg",
        "yi" => "yi.svg",
        "mistral" => "mistral-color.svg",
        "xai" => "xai.svg",
        "cohere" => "cohere-color.svg",
        "perplexity" => "perplexity-color.svg",
        "azure" => "azure-color.svg",
        "groq" => "groq.svg",
        "cerebras" => "cerebras.svg",
        "sambanova" => "sambanova-color.svg",
        "together" => "together-color.svg",
        "fireworks" => "fireworks-color.svg",
        "nvidia" => "nvidia-color.svg",
        "github" => "github.svg",
        "cline" => "cline.svg",
        "openrouter" => "openrouter.svg",
        "siliconflow" => "siliconcloud-color.svg",
        "302ai" => "ai302-color.svg",
        "aihubmix" => "aihubmix-color.svg",
        "ollama" => "ollama.svg",
        "lmstudio" => "lmstudio.svg",
        "vllm" => "vllm-color.svg",
        "xinference" => "xinference-color.svg",
        _ => return None,
    })
}

/// Every vendor the Add sheet offers. Only vendors whose endpoint
/// shapes are certain belong here; entries with a per-customer host
/// say so in `note`.
pub const VENDORS: &[VendorPreset] = &[
    VendorPreset { id: "openai", name: "OpenAI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.openai.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://platform.openai.com/api-keys") },
    VendorPreset { id: "anthropic", name: "Anthropic", short: None, kind: VendorKind::Vendor, protocol: "anthropic", chat: None, responses: None, anthropic: Some("https://api.anthropic.com"), gemini: None, note: None, pair: None, keys_url: Some("https://console.anthropic.com/settings/keys") },
    VendorPreset { id: "gemini", name: "Google Gemini", short: None, kind: VendorKind::Vendor, protocol: "gemini", chat: None, responses: None, anthropic: None, gemini: Some("https://generativelanguage.googleapis.com/v1beta"), note: None, pair: None, keys_url: Some("https://aistudio.google.com/apikey") },
    VendorPreset { id: "deepseek", name: "DeepSeek", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.deepseek.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://platform.deepseek.com/api_keys") },
    VendorPreset { id: "moonshot", name: "Moonshot AI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.moonshot.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("moonshot"), keys_url: Some("https://platform.moonshot.ai/console/api-keys") },
    VendorPreset { id: "moonshot-cn", name: "Moonshot AI 中国版", short: Some("Moonshot AI"), kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.moonshot.cn/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("moonshot"), keys_url: Some("https://platform.moonshot.cn/console/api-keys") },
    VendorPreset { id: "qwen", name: "通义千问 Qwen", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://dashscope.aliyuncs.com/compatible-mode/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://bailian.console.aliyun.com/?apiKey=1") },
    VendorPreset { id: "zhipu", name: "智谱 GLM", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://open.bigmodel.ai/api/paas/v4/"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("zhipu"), keys_url: Some("https://open.bigmodel.ai/usercenter/apikeys") },
    VendorPreset { id: "zhipu-cn", name: "智谱 GLM 中国版", short: Some("智谱 GLM"), kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://open.bigmodel.cn/api/paas/v4/"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("zhipu"), keys_url: Some("https://open.bigmodel.cn/usercenter/apikeys") },
    VendorPreset { id: "doubao", name: "火山引擎 Doubao", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://ark.cn-beijing.volces.com/api/v3"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey") },
    VendorPreset { id: "minimax", name: "MiniMax", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.minimax.io/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("minimax"), keys_url: None },
    VendorPreset { id: "minimax-cn", name: "MiniMax 中国版", short: Some("MiniMax"), kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.minimaxi.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: Some("minimax"), keys_url: None },
    VendorPreset { id: "baidu", name: "百度千帆", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://qianfan.baidubce.com/v2"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "tencent", name: "腾讯混元", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.hunyuan.cloud.tencent.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://console.cloud.tencent.com/cam/capi") },
    VendorPreset { id: "xunfei", name: "讯飞星火", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://spark-api-open.xf-yun.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "stepfun", name: "阶跃星辰", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.stepfun.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "yi", name: "零一万物", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.lingyiwanwu.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "mistral", name: "Mistral AI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.mistral.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://console.mistral.ai/api-keys") },
    VendorPreset { id: "xai", name: "xAI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.x.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "cohere", name: "Cohere", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.cohere.com/compatibility/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://dashboard.cohere.com/api-keys") },
    VendorPreset { id: "perplexity", name: "Perplexity", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.perplexity.ai"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://www.perplexity.ai/settings/api") },
    VendorPreset { id: "azure", name: "Azure OpenAI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://YOUR-RESOURCE.openai.azure.com/openai/deployments"), responses: None, anthropic: None, gemini: None, note: Some("把 YOUR-RESOURCE 换成你的资源名，并补全 deployment 与 api-version 路径"), pair: None, keys_url: Some("https://portal.azure.com/") },
    VendorPreset { id: "groq", name: "Groq", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.groq.com/openai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://console.groq.com/keys") },
    VendorPreset { id: "cerebras", name: "Cerebras", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.cerebras.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "sambanova", name: "SambaNova", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.sambanova.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "together", name: "Together AI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.together.xyz/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://api.together.ai/settings/api-keys") },
    VendorPreset { id: "fireworks", name: "Fireworks AI", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.fireworks.ai/inference/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "nvidia", name: "NVIDIA NIM", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://integrate.api.nvidia.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "github", name: "GitHub Models", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://models.github.ai/inference"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://github.com/settings/tokens") },
    VendorPreset { id: "cline", name: "Cline", short: None, kind: VendorKind::Vendor, protocol: "chat", chat: Some("https://api.cline.bot/api/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "openrouter", name: "OpenRouter", short: None, kind: VendorKind::Relay, protocol: "chat", chat: Some("https://openrouter.ai/api/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://openrouter.ai/settings/keys") },
    VendorPreset { id: "siliconflow", name: "硅基流动", short: None, kind: VendorKind::Relay, protocol: "chat", chat: Some("https://api.siliconflow.cn/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: Some("https://cloud.siliconflow.cn/account/ak") },
    VendorPreset { id: "302ai", name: "302.AI", short: None, kind: VendorKind::Relay, protocol: "chat", chat: Some("https://api.302.ai/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "aihubmix", name: "AiHubMix", short: None, kind: VendorKind::Relay, protocol: "chat", chat: Some("https://aihubmix.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "packycode", name: "PackyCode", short: None, kind: VendorKind::Relay, protocol: "chat", chat: Some("https://api.packycode.com/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "ollama", name: "Ollama", short: None, kind: VendorKind::Local, protocol: "chat", chat: Some("http://localhost:11434/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "lmstudio", name: "LM Studio", short: None, kind: VendorKind::Local, protocol: "chat", chat: Some("http://localhost:1234/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "llamacpp", name: "llama.cpp", short: None, kind: VendorKind::Local, protocol: "chat", chat: Some("http://localhost:8080/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "vllm", name: "vLLM", short: None, kind: VendorKind::Local, protocol: "chat", chat: Some("http://localhost:8000/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
    VendorPreset { id: "xinference", name: "Xinference", short: None, kind: VendorKind::Local, protocol: "chat", chat: Some("http://localhost:9997/v1"), responses: None, anthropic: None, gemini: None, note: None, pair: None, keys_url: None },
];

/// One-line management display for stored capability metadata, or `None`
/// when nothing is known beyond the configured protocol.
pub fn describe_capabilities(
    capabilities: &ProviderCapabilities,
    current: Protocol,
) -> Option<String> {
    if *capabilities == ProviderCapabilities::default() {
        return None;
    }
    fn said(value: Option<bool>) -> &'static str {
        match value {
            Some(true) => "yes",
            Some(false) => "no",
            None => "unknown",
        }
    }
    let protocols = if capabilities.supported_protocols.is_empty() {
        current.as_str().to_owned()
    } else {
        capabilities
            .supported_protocols
            .iter()
            .map(|p| p.as_str())
            .collect::<Vec<_>>()
            .join("+")
    };
    Some(format!(
        "capabilities {protocols}; stream {}; tools {}; vision {}",
        said(capabilities.streaming),
        said(capabilities.tools),
        said(capabilities.vision),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_hosts_prefill_their_protocols_and_answers() {
        let openai =
            preset_capabilities("https://api.openai.com/v1", Protocol::Chat).expect("preset");
        assert_eq!(
            openai.supported_protocols,
            vec![Protocol::Chat, Protocol::Responses]
        );
        assert_eq!(openai.streaming, Some(true));
        assert_eq!(openai.tools, Some(true));
        assert_eq!(openai.vision, Some(true));
        let anthropic =
            preset_capabilities("https://api.anthropic.com", Protocol::Anthropic).expect("preset");
        assert_eq!(anthropic.supported_protocols, vec![Protocol::Anthropic]);
        let deepseek =
            preset_capabilities("https://api.deepseek.com/v1", Protocol::Chat).expect("preset");
        assert_eq!(deepseek.vision, Some(false));
    }

    #[test]
    fn cline_prefills_chat_and_streaming_only() {
        // The Cline API speaks Chat and answers streamed asks; tools and
        // image input are unconfirmed, so they stay unknown.
        let cline =
            preset_capabilities("https://api.cline.bot/api/v1", Protocol::Chat).expect("preset");
        assert_eq!(cline.supported_protocols, vec![Protocol::Chat]);
        assert_eq!(cline.streaming, Some(true));
        assert_eq!(cline.tools, None);
        assert_eq!(cline.vision, None);
    }

    #[test]
    fn hosts_match_through_scheme_case_port_path_and_subdomains() {
        for url in [
            "HTTPS://API.OPENAI.COM:443/v1",
            "https://api.openai.com./v1",
            "http://api.openai.com/v1/chat/completions?x=1",
            "https://api.openai.com",
        ] {
            let preset = preset_capabilities(url, Protocol::Chat).expect("preset");
            assert_eq!(preset.streaming, Some(true), "{url}");
        }
        let azure = preset_capabilities("https://my-shop.openai.azure.com/", Protocol::Chat)
            .expect("preset");
        assert_eq!(
            azure.supported_protocols,
            vec![Protocol::Chat, Protocol::Responses]
        );
    }

    #[test]
    fn unknown_hosts_and_lookalike_suffixes_have_no_preset() {
        for url in [
            "https://relay.example.com/v1",
            "http://localhost:11434/v1",
            "https://evilopenai.azure.com/",
            "https://openai.azure.com.evil.example/",
            "not a url at all",
            "",
        ] {
            assert_eq!(preset_capabilities(url, Protocol::Chat), None, "{url}");
        }
    }

    #[test]
    fn a_protocol_the_vendor_list_misses_keeps_the_answers_but_no_list() {
        let preset =
            preset_capabilities("https://api.anthropic.com", Protocol::Chat).expect("preset");
        assert!(preset.supported_protocols.is_empty());
        assert_eq!(preset.streaming, Some(true));
    }

    #[test]
    fn existing_customized_metadata_is_never_overwritten() {
        let stored = ProviderCapabilities {
            supported_protocols: vec![Protocol::Chat],
            streaming: Some(false),
            tools: None,
            vision: None,
        };
        assert_eq!(
            capabilities_for_add(Some(&stored), "https://api.openai.com/v1", Protocol::Chat),
            stored
        );
        assert_eq!(
            capabilities_for_add(None, "https://relay.example.com/v1", Protocol::Chat),
            ProviderCapabilities::default()
        );
        let fresh = capabilities_for_add(None, "https://api.deepseek.com/v1", Protocol::Chat);
        assert_eq!(fresh.tools, Some(true));
    }

    #[test]
    fn vendor_catalog_has_unique_ids_usable_urls_and_paired_regions() {
        use std::collections::{HashMap, HashSet};
        assert!(!VENDORS.is_empty());
        let mut ids = HashSet::new();
        let mut pairs: HashMap<&str, usize> = HashMap::new();
        for v in VENDORS {
            assert!(ids.insert(v.id), "duplicate vendor id {}", v.id);
            assert!(
                v.chat.is_some() || v.responses.is_some() || v.anthropic.is_some() || v.gemini.is_some(),
                "vendor {} has no URL",
                v.id
            );
            assert!(
                ["chat", "responses", "anthropic", "gemini"].contains(&v.protocol),
                "vendor {} has a bad protocol",
                v.id
            );
            if let Some(pair) = v.pair {
                *pairs.entry(pair).or_default() += 1;
            }
            if let Some(keys_url) = v.keys_url {
                assert!(
                    keys_url.starts_with("https://"),
                    "vendor {} has a non-https keys_url",
                    v.id
                );
            }
        }
        for (pair, n) in pairs {
            assert_eq!(n, 2, "pair {pair} should link exactly two regions");
        }
    }
}
