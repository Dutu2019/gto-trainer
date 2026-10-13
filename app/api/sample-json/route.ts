import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

const JSON_OUTPUT_DIR = path.join(process.cwd(), "data", "raw");

export async function GET(request: NextRequest) {
  const sample_json_path = path.join(
    JSON_OUTPUT_DIR,
    "btn_bb_river_QsJh4d8c3s.json",
  );

  try {
    const data = await fs.readFile(sample_json_path, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
