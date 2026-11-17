// The API a model id says it is made for, read from the id alone, as
// vendors' OpenAI-style lists say no more (the reference's
// `catalog.ServesOf`, mirrored in `crates/router/src/serves.rs`):
// `text-embedding-3-small`, `bge-reranker-v2-m3`, `tts-1`, `whisper-1`.
// Voyage AI makes embedding models alone and names them `voyage-*` with
// no `embed` in the id.

export type Serves = "chat" | "embedding" | "rerank" | "transcription" | "speech";

export function servesOf(id: string): Serves {
  let tail = id.toLowerCase();
  const slash = tail.lastIndexOf("/");
  if (slash >= 0) tail = tail.slice(slash + 1);
  if (tail.includes("rerank")) return "rerank";
  if (tail.includes("embed") || tail.startsWith("bge-") || tail.startsWith("voyage-")) {
    return "embedding";
  }
  if (tail.includes("whisper") || tail.includes("transcribe")) return "transcription";
  if (tail.startsWith("tts-") || tail.includes("-tts")) return "speech";
  return "chat";
}
