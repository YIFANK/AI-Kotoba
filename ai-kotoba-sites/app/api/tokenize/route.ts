import { json } from "../../../lib/server";

export async function POST() {
  return json(
    { error: "公网版暂时使用浏览器日语分词；SudachiPy 仍可在本地 Python 版使用。" },
    { status: 501 },
  );
}
