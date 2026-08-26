// IPFS CID 工具：链上仅存 sha2-256 多哈希摘要（bytes32），前端负责 CID 解析/重建与哈希校验。
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import type { MultihashDigest } from "multiformats/hashes/interface";

const RAW_CODEC = 0x55;
const SHA256_CODE = 0x12;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 由 32 字节摘要构造 sha2-256 多哈希（同步，纯数据结构）。 */
function sha256DigestOf(bytes: Uint8Array): MultihashDigest<typeof SHA256_CODE> {
  const multihash = {
    code: SHA256_CODE,
    size: 32,
    digest: bytes,
    bytes: concatBytes([Uint8Array.from([SHA256_CODE, 0x20]), bytes]),
  };
  return multihash as unknown as MultihashDigest<typeof SHA256_CODE>;
}

/** 把用户粘贴的 CID 字符串或裸 32 字节十六进制摘要解析为 bytes32 摘要（0x 开头）。 */
export async function digestFromCidOrHex(input: string): Promise<`0x${string}` | undefined> {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as `0x${string}`;
  try {
    const cid = CID.parse(trimmed);
    const digest = Uint8Array.from(cid.multihash.digest);
    if (digest.length !== 32) return undefined;
    return `0x${Buffer.from(digest).toString("hex")}` as `0x${string}`;
  } catch {
    return undefined;
  }
}

/** 由链上摘要重建可检索的 CID（v0 dag-pb 与 v1 raw 各一个）。 */
export function cidsFromDigest(digest: `0x${string}`): { cidv0?: string; cidv1?: string } {
  try {
    const bytes = Uint8Array.from(Buffer.from(digest.slice(2), "hex"));
    const multihash = sha256DigestOf(bytes);
    const cidv0 = CID.createV0(multihash).toString();
    const cidv1 = CID.createV1(RAW_CODEC, multihash).toString();
    return { cidv0, cidv1 };
  } catch {
    return {};
  }
}

export function gatewayUrl(cid: string) {
  return `https://ipfs.io/ipfs/${cid}`;
}

/** 对 raw（0x55）编码的 CID 校验网关取回内容：sha2-256(内容) == 链上摘要。 */
export async function verifyRawContent(cid: string, digest: `0x${string}`): Promise<"match" | "mismatch" | "unsupported"> {
  let parsed: CID;
  try {
    parsed = CID.parse(cid);
  } catch {
    return "unsupported";
  }
  if (parsed.code !== RAW_CODEC) return "unsupported";
  try {
    const response = await fetch(gatewayUrl(cid));
    if (!response.ok) return "mismatch";
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = await sha256.digest(bytes);
    const actual = `0x${Buffer.from(hash.digest).toString("hex")}`;
    return actual.toLowerCase() === digest.toLowerCase() ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

/** 通过 Pinata pin 文件并返回 CID（JWT 由用户粘贴，不进仓库）。 */
export async function pinFileToPinata(file: File, jwt: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  });
  if (!response.ok) throw new Error(`Pinata pin failed: ${response.status}`);
  const payload = await response.json() as { IpfsHash?: string };
  if (!payload.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return payload.IpfsHash;
}
