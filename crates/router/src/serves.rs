//! The API a model id says it is made for, read from the id alone, as
//! vendors' OpenAI-style lists say no more (the reference's
//! `catalog.ServesOf`): `text-embedding-3-small`, `bge-reranker-v2-m3`,
//! `tts-1`, `whisper-1`. Voyage AI makes embedding models alone and
//! names them `voyage-*` with no `embed` in the id.

/// A non-chat API a model id names. `Chat` is any model no other arm
/// claims — the picker's default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Serves {
    /// `/v1/embeddings`, OpenAI's shape.
    Embedding,
    /// `/v1/rerank`, the shape Cohere, Jina and Voyage share.
    Rerank,
    /// `/v1/audio/transcriptions`, Whisper's shape.
    Transcription,
    /// `/v1/audio/speech`, OpenAI's TTS shape.
    Speech,
    /// Any other model: a chat picker entry.
    Chat,
}

/// Classify a model id by the API its name says it serves, mirroring the
/// reference's `catalog.ServesOf`. The vendor prefix is stripped first
/// (`openrouter/openai/text-embedding-3-small` reads as its tail).
pub fn serves_of(id: &str) -> Serves {
    let mut id = id.to_ascii_lowercase();
    if let Some(slash) = id.rfind('/') {
        id = id[slash + 1..].to_owned();
    }
    if id.contains("rerank") {
        Serves::Rerank
    } else if id.contains("embed") || id.starts_with("bge-") || id.starts_with("voyage-") {
        Serves::Embedding
    } else if id.contains("whisper") || id.contains("transcribe") {
        Serves::Transcription
    } else if id.starts_with("tts-") || id.contains("-tts") {
        Serves::Speech
    } else {
        Serves::Chat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_id() {
        assert_eq!(serves_of("text-embedding-3-small"), Serves::Embedding);
        assert_eq!(serves_of("voyage-4-large"), Serves::Embedding);
        assert_eq!(serves_of("bge-m3"), Serves::Embedding);
        assert_eq!(serves_of("bge-reranker-v2-m3"), Serves::Rerank);
        assert_eq!(serves_of("cohere/rerank-3-lite"), Serves::Rerank);
        assert_eq!(serves_of("whisper-1"), Serves::Transcription);
        assert_eq!(serves_of("gpt-4o-mini-tts"), Serves::Speech);
        assert_eq!(serves_of("tts-1"), Serves::Speech);
        assert_eq!(serves_of("deepseek-chat"), Serves::Chat);
        assert_eq!(serves_of("gpt-4o"), Serves::Chat);
    }
}
