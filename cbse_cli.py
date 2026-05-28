import argparse
import asyncio
from cbse_parser.generator import generate_answer


def main():
    parser = argparse.ArgumentParser(description="Generate CBSE‑style answer from a question.")
    parser.add_argument("question", help="The exam question text (enclose in quotes if it contains spaces).")
    parser.add_argument("-t", "--template", help="Optional custom markdown template file.")
    args = parser.parse_args()
    custom_template = None
    if args.template:
        try:
            with open(args.template, "r", encoding="utf-8") as f:
                custom_template = f.read()
        except Exception as e:
            print(f"Error reading template file: {e}")
            return
    answer = asyncio.run(generate_answer(args.question, custom_template))
    print(answer)


if __name__ == "__main__":
    main()

