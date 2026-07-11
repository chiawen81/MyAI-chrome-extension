# 統計單一 Claude Code session（視窗）的 token 用量，換算 Claude API 等值費用。
# 用法：python count-session-tokens.py <session-id> [標記檔路徑]
# 資料來源：~/.claude/projects/*/<session-id>.jsonl（Claude Code 的 session 逐字稿）
# 有給標記檔時：額外回報「本段」（標記行之後的新增用量），並於結束時把目前行數寫回標記檔，
# 供下次 /commit-session 只回報兩次 commit 之間的用量（逐字稿只增不減，行數可當進度標記）。
# 注意：訂閱方案實際不按 token 扣費，輸出為「若走 API 計價」的等值估算。
import glob
import json
import os
import sys
from collections import defaultdict

# Windows 主控台預設 cp950，中文與 ≈ 符號會炸
sys.stdout.reconfigure(encoding="utf-8")

# USD / 1M tokens: (input, output, cache寫入5m, cache寫入1h, cache讀取)
# 依 Anthropic 官方定價：cache 寫入 = input×1.25（5m TTL）／×2（1h TTL）；cache 讀取 = input×0.1
PRICES = {
    "claude-fable-5":    (10.0, 50.0, 12.50, 20.0, 1.00),
    "claude-mythos-5":   (10.0, 50.0, 12.50, 20.0, 1.00),
    "claude-opus-4-8":   (5.0, 25.0, 6.25, 10.0, 0.50),
    "claude-opus-4-7":   (5.0, 25.0, 6.25, 10.0, 0.50),
    "claude-opus-4-6":   (5.0, 25.0, 6.25, 10.0, 0.50),
    "claude-opus-4-5":   (5.0, 25.0, 6.25, 10.0, 0.50),
    "claude-sonnet-5":   (3.0, 15.0, 3.75, 6.0, 0.30),
    "claude-sonnet-4-6": (3.0, 15.0, 3.75, 6.0, 0.30),
    "claude-sonnet-4-5": (3.0, 15.0, 3.75, 6.0, 0.30),
    "claude-haiku-4-5":  (1.0, 5.0, 1.25, 2.0, 0.10),
}


def find_transcript(session_id: str) -> str | None:
    pattern = os.path.join(
        os.path.expanduser("~"), ".claude", "projects", "*", f"{session_id}.jsonl"
    )
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def new_stats():
    # model -> [input, output, cache寫5m, cache寫1h, cache讀]
    return defaultdict(lambda: [0, 0, 0, 0, 0])


def add_usage(stats, model, usage):
    s = stats[model]
    s[0] += usage.get("input_tokens", 0)
    s[1] += usage.get("output_tokens", 0)
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):  # 新格式有 5m/1h 拆分
        s[2] += cc.get("ephemeral_5m_input_tokens", 0)
        s[3] += cc.get("ephemeral_1h_input_tokens", 0)
    else:  # 舊格式只有總數，以 5m 費率估
        s[2] += usage.get("cache_creation_input_tokens", 0)
    s[4] += usage.get("cache_read_input_tokens", 0)


def fmt(n):
    # 1,000 以上以 K 表示（一位小數），避免長數字難讀；千位以下原樣
    return f"{n / 1000:,.1f}K" if n >= 1000 else str(n)


def report(title, stats, requests):
    total_tokens = 0
    total_cost = 0.0
    unknown = []
    print(f"── {title}（API 請求數 {requests}）──")
    if not stats:
        print("（無用量）")
        return
    for model, (inp, out, c5, c1, cr) in stats.items():
        tokens = inp + out + c5 + c1 + cr
        total_tokens += tokens
        line = (
            f"[{model}] input={fmt(inp)} output={fmt(out)} "
            f"cache寫入={fmt(c5 + c1)} cache讀取={fmt(cr)}（小計 {fmt(tokens)} tokens）"
        )
        p = PRICES.get(model)
        if p:
            cost = (inp * p[0] + out * p[1] + c5 * p[2] + c1 * p[3] + cr * p[4]) / 1e6
            total_cost += cost
            line += f" ≈ ${cost:.4f}"
        else:
            unknown.append(model)
            line += "（無定價資料，未計費用）"
        print(line)
    print(f"合計：{fmt(total_tokens)} tokens ≈ ${total_cost:.4f} USD（API 等值估算）")
    if unknown:
        print(f"注意：{', '.join(unknown)} 缺定價資料，合計費用低估。")


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("用法：python count-session-tokens.py <session-id> [標記檔路徑]")
        return 1
    path = find_transcript(sys.argv[1])
    if not path:
        print(f"找不到 session 逐字稿：{sys.argv[1]}")
        return 1
    mark_path = sys.argv[2] if len(sys.argv) == 3 else None
    marked_lines = 0
    if mark_path and os.path.exists(mark_path):
        try:
            marked_lines = json.load(open(mark_path, encoding="utf-8")).get("lines", 0)
        except (json.JSONDecodeError, OSError):
            marked_lines = 0

    total = new_stats()
    segment = new_stats()
    seen = set()
    total_requests = segment_requests = 0
    line_no = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line_no += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "assistant":
                continue
            msg = obj.get("message") or {}
            usage = msg.get("usage")
            if not usage:
                continue
            # 同一次 API 回應會拆成多行（每個 content block 一行），usage 重複，需去重
            key = obj.get("requestId") or msg.get("id")
            if key in seen:
                continue
            seen.add(key)
            model = msg.get("model", "unknown")
            add_usage(total, model, usage)
            total_requests += 1
            if line_no > marked_lines:
                add_usage(segment, model, usage)
                segment_requests += 1

    if mark_path:
        if marked_lines > 0:
            report("本段（自上次 /commit-session 後）", segment, segment_requests)
        else:
            print("（首次執行，本段＝視窗累計）")
        os.makedirs(os.path.dirname(mark_path) or ".", exist_ok=True)
        json.dump({"lines": line_no}, open(mark_path, "w", encoding="utf-8"))
    report("視窗累計", total, total_requests)
    return 0


if __name__ == "__main__":
    sys.exit(main())
