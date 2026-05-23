"""
gen_coupons.py — Generate fresh coupon codes for Eastern Farm.

Usage:
    python3 gen_coupons.py            # Print 50 new codes to stdout
    python3 gen_coupons.py --update   # Update data/coupons.json with 50 fresh codes
    python3 gen_coupons.py -n 100     # Generate 100 codes

Codes look like: EMFARM-A4F8K2 (6 chars, uppercase alphanumeric, no ambiguous chars)
"""

import secrets
import string
import json
import os
import argparse

# Avoid ambiguous characters: O/0, I/1, etc.
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
PREFIX = "EMFARM-"


def make_code():
    return PREFIX + ''.join(secrets.choice(CODE_CHARS) for _ in range(CODE_LENGTH))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-n', '--count', type=int, default=50, help='Number of codes')
    parser.add_argument('--tier-5-pct', type=int, default=70, help='% of codes that are $5 tier')
    parser.add_argument('--tier-20-pct', type=int, default=25, help='% of codes that are $20 tier')
    parser.add_argument('--update', action='store_true', help='Write to data/coupons.json')
    args = parser.parse_args()

    codes = []
    seen = set()
    while len(codes) < args.count:
        c = make_code()
        if c in seen:
            continue
        seen.add(c)

        # Tier distribution
        roll = secrets.randbelow(100)
        if roll < args.tier_5_pct:
            tier = "tier_5"
        elif roll < args.tier_5_pct + args.tier_20_pct:
            tier = "tier_20"
        else:
            tier = "tier_special"

        codes.append({"code": c, "tier": tier, "used": False})

    if args.update:
        path = os.path.join(os.path.dirname(__file__), "..", "data", "coupons.json")
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        data["codes"] = codes
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Updated {path} with {len(codes)} fresh codes.")
        print(f"  $5 tier: {sum(1 for c in codes if c['tier']=='tier_5')}")
        print(f"  $20 tier: {sum(1 for c in codes if c['tier']=='tier_20')}")
        print(f"  Special: {sum(1 for c in codes if c['tier']=='tier_special')}")
    else:
        print(json.dumps(codes, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
