#!/usr/bin/env python3
"""Explicit, conservative Word-to-LaTeX review, for the interactive CLI.

No automatic incorporation. Only literal prose spans can be applied. Equations,
references, formatting and structural changes remain visible manual-review items.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
from provenance import plain_records, read_record, record_name, record_text
import os
import tempfile
import re
import sys
import subprocess
import zipfile
from pathlib import Path

from docx import Document
from lxml import etree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def paragraphs(path):
    result = []
    bibliography = False
    for p in Document(path).paragraphs:
        text = "".join(n.text or "" for n in p._p.iter() if n.tag in {W + "t", M + "t"})
        text = " ".join(text.split())
        if not text:
            continue
        bibliography |= text.lower() in {
            "references",
            "bibliography",
        } or p.style.name.startswith("Bibliography")
        citations = [
            "".join(n.text or "" for n in run.iter(W + "t"))
            for run in p._p.iter(W + "r")
            if any(
                n.tag == W + "vertAlign" and n.get(W + "val") == "superscript"
                for n in run.iter()
            )
        ]
        citations = [text for text in citations if re.fullmatch(r"[\d,;–—\- ]+", text)]
        equations = [
            etree.tostring(n, method="c14n").decode() for n in p._p.iter(M + "oMath")
        ]
        result.append(
            {
                "text": text,
                "math": equations,
                "bibliography": bibliography,
                "citations": citations,
            }
        )
    return result


def check_export(source, current):
    record = source.with_name(record_name(f".{source.stem}-export"))
    if plain_records():
        root = next(
            (parent for parent in source.parents if (parent / ".git").exists()),
            source.parent,
        )
        record = root / "logs" / source.stem / "export.log"
    if not record.exists():
        raise ValueError(
            "Current DOCX has no export ownership record. Compile this TEX with Aspyrus first."
        )
    data = read_record(record)
    if data.get("source_sha256") != digest(source):
        raise ValueError("Current DOCX is stale. Compile this TEX before comparing.")
    outputs = data.get("output_sha256", {})
    expected = outputs.get(current.name)
    if isinstance(expected, dict):
        expected = expected.get("sha256")
    if expected != digest(current):
        raise ValueError(
            "Current DOCX differs from its export record. Compile before comparing."
        )
    root = source.parent
    for parent in source.parents:
        if any(
            (parent / name).exists()
            for name in (".git", ".aspyrus.json", ".localleaf.json")
        ):
            root = parent
            break
    for name, sha in data.get("dependency_sha256", {}).items():
        target = root / name
        if not target.is_file() or digest(target) != sha:
            raise ValueError(f"Export dependency changed: {name}. Compile first.")
    return record


def literal_patch(source, old, before, after):
    """Map only an exact prose span with exact neighbour words, never TeX syntax."""
    start = source.find("\\begin{document}")
    end = source.find("\\end{document}")
    if start < 0 or end < start:
        return None
    body = source[start + len("\\begin{document}") : end]
    offset = start + len("\\begin{document}")
    # Mask commands, comments and all mathematical regions; transparent wrappers
    # retain their ordinary contents, but patches cannot cross their braces.
    mask = list(body)
    pattern = r"(?m)%[^\n]*|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$]*\$|\\(?:cite\w*|revref|ref|eqref|label|includegraphics|bibliography|bibliographystyle)(?:\[[^\]]*\])?\{[^}]*\}|\\[A-Za-z@]+|[{}]"
    for m in re.finditer(pattern, body):
        mask[m.start() : m.end()] = "\0" * (m.end() - m.start())
    for m in re.finditer(
        r"\\begin\{(equation\*?|align\*?|gather\*?|tabular|thebibliography)\}[\s\S]*?\\end\{\1\}",
        body,
    ):
        mask[m.start() : m.end()] = "\0" * (m.end() - m.start())
    # Never map a number/variable without prose anchors.
    left = before[-45:]
    right = after[:45]
    if len(re.findall(r"[A-Za-z]{2,}", left + right)) < 3:
        return None

    def transparent(value):
        return re.sub(
            r"\\(?:redtext|bluetext|textbf|textit|emph)\s*\{|\\textcolor\s*\{[^}]+\}\s*\{|[{}]",
            "",
            value,
        )

    candidates = []
    if old:
        for m in re.finditer(re.escape(old), body):
            a, b = m.span()
            if "\0" in "".join(mask[a:b]):
                continue
            # TeX wrappers can interrupt an anchor, so require at least one
            # substantial unchanged neighbour on the actual source line.
            if (len(left) >= 15 and transparent(body[:a]).endswith(left)) or (
                len(right) >= 15 and transparent(body[b:]).startswith(right)
            ):
                candidates.append((a + offset, b + offset))
    else:
        anchor = left + right
        for m in re.finditer(re.escape(anchor), body):
            a = m.start() + len(left)
            if "\0" not in "".join(mask[m.start() : m.end()]):
                candidates.append((a + offset, a + offset))
    return candidates[0] if len(candidates) == 1 else None


def escape(text):
    return "".join(
        {
            "\\": r"\textbackslash{}",
            "{": r"\{",
            "}": r"\}",
            "%": r"\%",
            "&": r"\&",
            "#": r"\#",
            "$": r"\$",
            "_": r"\_",
            "^": r"\textasciicircum{}",
            "~": r"\textasciitilde{}",
        }.get(c, c)
        for c in text
    )


def compare(source, current, returned, original=None):
    source, current, returned = map(
        lambda p: Path(p).resolve(), (source, current, returned)
    )
    record = check_export(source, current)
    baseline = Path(original).resolve() if original else current
    if original and baseline == returned:
        raise ValueError(
            "The sent baseline and returned Word document must be different files."
        )
    files = {
        name: {"path": str(p), "sha256": digest(p)}
        for name, p in {
            "source": source,
            "current": current,
            "returned": returned,
            "baseline": baseline,
            "export_record": record,
            "engine": Path(__file__),
        }.items()
    }
    tex = source.read_bytes().decode("utf-8")
    all_old, all_new = paragraphs(baseline), paragraphs(returned)
    bibliography = {
        "baseline_paragraphs": sum(p["bibliography"] for p in all_old),
        "returned_paragraphs": sum(p["bibliography"] for p in all_new),
        "policy": "excluded; edit atomic reference records and use bibgen.py",
    }
    old = [p for p in all_old if not p["bibliography"]]
    new = [p for p in all_new if not p["bibliography"]]
    changes = []

    def add(a, b, old_text, new_text, status, patch=None):
        ident = hashlib.sha256(
            json.dumps([a, b, old_text, new_text], ensure_ascii=False).encode()
        ).hexdigest()[:16]
        changes.append(
            {
                "id": ident,
                "before": old_text,
                "after": new_text,
                "context_before": a,
                "context_after": b,
                "status": status,
                "patch": patch,
                "decision": "skip",
            }
        )

    matcher = difflib.SequenceMatcher(
        None, [p["text"] for p in old], [p["text"] for p in new], autojunk=False
    )
    for tag, i, j, k, stop in matcher.get_opcodes():
        if tag == "equal":
            for a, b in zip(old[i:j], new[k:stop]):
                if a["math"] != b["math"]:
                    add(
                        a["text"],
                        "",
                        "[Equation structure]",
                        "[Equation structure changed]",
                        "manual: equation or equation formatting changed",
                    )
            continue
        if tag != "replace" or j - i != stop - k:
            add(
                "",
                "",
                "\n".join(p["text"] for p in old[i:j]),
                "\n".join(p["text"] for p in new[k:stop]),
                "manual: paragraph insertion, deletion or alignment",
            )
            continue
        for a, b in zip(old[i:j], new[k:stop]):
            if a["math"] != b["math"]:
                add(
                    a["text"],
                    "",
                    "[Equation structure]",
                    "[Equation structure changed]",
                    "manual: equation or equation formatting changed",
                )
            aa, bb = re.findall(r"\S+\s*", a["text"]), re.findall(r"\S+\s*", b["text"])
            for op, x, y, z, q in difflib.SequenceMatcher(
                None, aa, bb, autojunk=False
            ).get_opcodes():
                if op == "equal":
                    continue
                previous, following = "".join(aa[:x]), "".join(aa[y:])
                removed, added = "".join(aa[x:y]), "".join(bb[z:q])
                if removed and added.startswith(removed):
                    previous += removed
                    added = added[len(removed) :]
                    removed = ""
                # Unchanged punctuation/spacing belongs to its existing source,
                # especially when a word sits inside a colour wrapper.
                while (
                    removed
                    and added
                    and removed[-1] == added[-1]
                    and not removed[-1].isalnum()
                ):
                    following = removed[-1] + following
                    removed, added = removed[:-1], added[:-1]
                patch = literal_patch(tex, removed, previous, following)
                status = (
                    "ready"
                    if patch
                    else "manual: ambiguous source or locally changed wording"
                )
                if a["bibliography"] or b["bibliography"]:
                    patch, status = (
                        None,
                        "manual: bibliography; edit atomic reference record instead",
                    )
                elif a["math"] != b["math"] and any(
                    text
                    and re.search(
                        r"(?<!\w)" + re.escape(text) + r"(?!\w)", removed + "\n" + added
                    )
                    for xml in a["math"] + b["math"]
                    for text in [
                        "".join(etree.fromstring(xml.encode()).itertext()).strip()
                    ]
                ):
                    patch, status = None, "manual: changed equation text"
                if re.search(
                    r"\[\d+(?:[ ,;–\-]+\d+)*\]", removed + "\n" + added
                ) or any(
                    re.search(
                        r"(?<!\w)" + re.escape(citation.strip()) + r"(?!\w)",
                        removed + "\n" + added,
                    )
                    for citation in a["citations"] + b["citations"]
                ):
                    patch, status = (
                        None,
                        "manual: citation change; preserve LaTeX citation keys",
                    )
                add(
                    previous,
                    following,
                    removed,
                    added,
                    status,
                    list(patch) if patch else None,
                )
    with zipfile.ZipFile(returned) as archive:
        xml = archive.read("word/document.xml")
        tracked = bool(re.search(rb"<w:(?:ins|del|moveFrom|moveTo)\b", xml))
    if tracked:
        for c in changes:
            c["patch"], c["status"] = (
                None,
                "manual: accept/reject tracked changes in Word first",
            )
    warning = "No sent baseline: differences may include newer local changes. Do not infer authorship."
    if original:
        warning = "Exact sent baseline selected; overlapping local changes require manual review."
    return {
        "schema": 1,
        "bibliography": bibliography,
        "git_baseline": git_baseline(source),
        "mode": "three-way" if original else "two-way",
        "warning": warning,
        "files": files,
        "changes": changes,
        "notice": "Bibliography entries excluded: update the reference library upstream. Plain text only. Formatting, comments, tables, images and layout are not incorporated. Equation differences are manual. Choose normal/red/blue for accepted replacements. Existing untouched colours survive.",
    }


def git_baseline(source):
    """Record the existing checkpoint without committing or changing branches."""

    def git(*args):
        result = subprocess.run(["git", *args], cwd=source.parent, capture_output=True)
        if result.returncode:
            raise ValueError(
                "Commit the manuscript source before interactive incorporation."
            )
        return result.stdout

    try:
        root = Path(git("rev-parse", "--show-toplevel").decode().strip())
        relative = source.relative_to(root).as_posix()
        commit = git("rev-parse", "HEAD").decode().strip()
        committed = git("show", f"HEAD:{relative}") == source.read_bytes()
        return {"commit": commit, "source_committed": committed, "path": relative}
    except (ValueError, OSError):
        return {"commit": None, "source_committed": False}


def revision_scope(source, position):
    """Detect authored revision scopes; a normal replacement must override colour."""
    for match in re.finditer(
        r"\\(?:redtext|bluetext)\s*\{|\\textcolor\s*\{[^}]+\}\s*\{", source[:position]
    ):
        depth, cursor = 1, match.end()
        while cursor < len(source) and depth:
            if source[cursor] == "\\":
                cursor += 2
                continue
            depth += (source[cursor] == "{") - (source[cursor] == "}")
            cursor += 1
        if match.end() <= position < cursor - 1:
            return True
    stack = []
    for match in re.finditer(
        r"\\(begin|end)\{(redblock|blueblock|collabtext)\}", source[:position]
    ):
        if match[1] == "begin":
            stack.append(match[2])
        elif stack and stack[-1] == match[2]:
            stack.pop()
    groups = []
    for match in re.finditer(
        r"\\begingroup(?:\s*\\color\{([^}]+)\})?|\\endgroup", source[:position]
    ):
        if match[0].startswith(r"\begingroup"):
            groups.append(match[1])
        elif groups:
            groups.pop()
    return bool(stack) or any(colour for colour in groups)


def has_colour_package(source):
    """Require explicit standard colour support; never edit the preamble implicitly."""
    preamble = source.split(r"\begin{document}", 1)[0]
    preamble = re.sub(r"(?m)(?<!\\)%[^\n]*", "", preamble)
    return any(
        {"color", "xcolor"} & {name.strip() for name in match[1].split(",")}
        for match in re.finditer(
            r"\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}",
            preamble,
        )
    )


def validate(review):
    for entry in review["files"].values():
        if digest(entry["path"]) != entry["sha256"]:
            raise ValueError(f"Review is stale: {entry['path']}. Compare again.")
    check_export(
        Path(review["files"]["source"]["path"]),
        Path(review["files"]["current"]["path"]),
    )


def prepare(review, decisions, mark_red=False):
    validate(review)
    source = Path(review["files"]["source"]["path"]).read_bytes().decode("utf-8")
    review["mark_red"] = bool(mark_red)
    selected = []
    known = {c["id"] for c in review["changes"]}
    if set(decisions) - known:
        raise ValueError("Unknown review change ID")
    for c in review["changes"]:
        decision = decisions.get(c["id"], c["decision"])
        if decision not in {"accept", "reject", "skip"}:
            raise ValueError("Invalid decision")
        c["decision"] = decision
        if decision == "accept":
            if c["status"] != "ready" or not c["patch"]:
                raise ValueError("Manual-review change cannot be applied automatically")
            selected.append(c)
    selected.sort(key=lambda c: c["patch"][0])
    for a, b in zip(selected, selected[1:]):
        if a["patch"][1] >= b["patch"][0]:
            raise ValueError("Overlapping edits require manual review")
    content = source
    for c in reversed(selected):
        a, b = c["patch"]
        if source[a:b] != c["before"]:
            raise ValueError("Source mapping changed")
        replacement = escape(c["after"])
        style = c.get("style", "red" if mark_red else "normal")
        if style not in {"normal", "red", "blue"}:
            raise ValueError("Unknown text style")
        if replacement.strip() and (style != "normal" or revision_scope(source, a)):
            if not has_colour_package(source):
                raise ValueError(
                    "Load \\usepackage{xcolor} (or color) in the preamble before marking text."
                )
            leading = replacement[: len(replacement) - len(replacement.lstrip())]
            trailing = replacement[len(replacement.rstrip()) :]
            command = r"\textcolor{" + (style if style != "normal" else "black") + "}{"
            replacement = leading + command + replacement.strip() + "}" + trailing
        content = content[:a] + replacement + content[b:]
    diff = "".join(
        difflib.unified_diff(
            source.splitlines(True),
            content.splitlines(True),
            fromfile="Current TEX",
            tofile="Accepted TEX",
        )
    )
    return {"original": source, "content": content, "diff": diff}


def atomic_text(path, content):
    if path.is_symlink():
        raise ValueError(f"Refusing symlinked review output: {path}")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(content.encode("utf-8"))
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_review(review, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / ".review-lock"
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise ValueError(
            "Another review is writing this exchange (or an interrupted run left .review-lock). Retry after that run ends."
        ) from error
    try:
        write_review_locked(review, directory)
    finally:
        lock.rmdir()


def outcome_summary(review):
    """Keep retained and pending differences visible after partial incorporation."""
    groups = {"accept": [], "reject": [], "skip": []}
    for change in review["changes"]:
        groups[change["decision"]].append(change)
    lines = [
        "Review outcomes (acceptance is not proof of a saved or validated edit):",
        f"Accepted: {len(groups['accept'])}; retained local: {len(groups['reject'])}; pending: {len(groups['skip'])}.",
    ]
    for decision, label in (("reject", "Retained local"), ("skip", "Pending")):
        for change in groups[decision]:
            reason = change.get("reason") or "No rationale recorded; requires review."
            lines.append(f"- {label} {change['id']}: {reason}")
    return "\n".join(lines)


def write_review_locked(review, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / record_name("review")
    if file.is_symlink() or (directory / "review.md").is_symlink():
        raise ValueError("Refusing symlinked review output")
    store = (
        read_record(file)
        if file.exists()
        else {"schema": 1, "documents": {}, "history": []}
    )
    if "documents" not in store:
        store = {
            "schema": 1,
            "documents": {Path(store["files"]["source"]["path"]).stem: store},
            "history": [],
        }
    name = Path(review["files"]["source"]["path"]).stem
    previous = store["documents"].get(name)
    if previous and previous["files"] != review["files"]:
        store["history"].append(previous)
    store["documents"][name] = review
    atomic_text(file, record_text(store))
    lines = [
        "# Word edit review",
        "",
        f"Earlier sessions remain in {file.name} history.",
        "",
    ]
    for name, item in store["documents"].items():
        lines += [
            f"## {name} — {item['mode']}",
            f"Starting Git commit: {item.get('git_baseline', {}).get('commit')}",
            "",
            item["warning"],
            "",
            item["notice"],
            "",
            outcome_summary(item),
            "",
        ]
        for c in item["changes"]:
            lines += [
                f"### {c['id']} — {c['decision']} / {c.get('style', 'normal')} ({c['status']})",
                "",
                "Before:",
                "",
                c["context_before"] + c["before"] + c["context_after"],
                "",
                "Proposed:",
                "",
                c["context_before"] + c["after"] + c["context_after"],
                "",
            ]
    atomic_text(directory / "review.md", "\n".join(lines))


def save_proposal(review, proposed, recovery):
    validate(review)
    source = Path(review["files"]["source"]["path"])
    checkpoint = git_baseline(source)
    if (
        not checkpoint["source_committed"]
        or checkpoint["commit"] != review["git_baseline"]["commit"]
    ):
        raise ValueError(
            "Starting commit or source changed. Commit/recompare before saving."
        )
    recovery.mkdir(parents=True, exist_ok=True)
    backup = recovery / (
        source.stem + "-" + review["files"]["source"]["sha256"][:16] + ".tex"
    )
    if backup.exists() and backup.read_bytes() != proposed["original"].encode():
        raise ValueError("Existing recovery copy differs; preserve it before saving.")
    if not backup.exists():
        with backup.open("xb") as handle:
            handle.write(proposed["original"].encode())
    validate(review)
    with tempfile.NamedTemporaryFile(dir=source.parent, delete=False) as handle:
        handle.write(proposed["content"].encode())
        temporary = Path(handle.name)
    try:
        os.chmod(temporary, source.stat().st_mode)
        os.replace(temporary, source)
    finally:
        temporary.unlink(missing_ok=True)
    review["saved_sha256"] = digest(source)
    review["recovery_copy"] = str(backup)


def interactive_review(review, output, default_style):
    checkpoint = review["git_baseline"]
    if not checkpoint["source_committed"]:
        raise ValueError(
            "Commit the current TEX source before interactive review. No automatic commits are made."
        )
    print(f"Starting Git checkpoint: {checkpoint['commit']}")
    write_review(review, output)
    try:
        for index, change in enumerate(review["changes"], 1):
            print(f"\nChange {index}/{len(review['changes'])} — {change['status']}")
            print(
                "Context: "
                + change["context_before"][-240:]
                + "["
                + change["before"]
                + "]"
                + change["context_after"][:240]
            )
            print("Remove: " + (change["before"] or "(nothing)"))
            print("Add:    " + (change["after"] or "(nothing)"))
            print(
                f"Recorded choice: {change['decision']} / {change.get('style', default_style)}"
            )
            while True:
                prompt = (
                    f"[a]ccept ({default_style}) / [n]ormal / [r]ed / [b]lue / [d]ecline / [s]kip / [q]uit / Enter keep: "
                    if change["status"] == "ready"
                    else "Manual item: [d]ecline / [s]kip / [q]uit / Enter keep: "
                )
                choice = input(prompt).strip().lower()
                if choice == "":
                    break
                if choice == "q":
                    write_review(review, output)
                    print("Choices recorded; TEX unchanged.")
                    return False
                if choice in {"d", "s"}:
                    if choice == "d":
                        reason = input("Reason for retaining local wording: ").strip()
                        if not reason:
                            print("Record a reason, or skip to leave this pending.")
                            continue
                        change["reason"] = reason
                    else:
                        change.pop("reason", None)
                    change["decision"] = "reject" if choice == "d" else "skip"
                    break
                if change["status"] == "ready" and choice in {"a", "n", "r", "b"}:
                    style = {
                        "a": default_style,
                        "n": "normal",
                        "r": "red",
                        "b": "blue",
                    }[choice]
                    old = dict(change)
                    change.update(decision="accept", style=style)
                    try:
                        prepare(review, {})
                    except ValueError as error:
                        change.clear()
                        change.update(old)
                        print(error)
                        continue
                    break
                print("Choose one of the listed options; nothing was accepted.")
            write_review(review, output)
        proposed = prepare(review, {})
        print("\n" + outcome_summary(review))
        print("\nAccepted TEX diff:\n" + (proposed["diff"] or "No accepted changes."))
        if (
            proposed["diff"]
            and input(
                "Type SAVE to write these edits, or Enter to leave TEX unchanged: "
            )
            == "SAVE"
        ):
            source = Path(review["files"]["source"]["path"])
            root = (
                subprocess.run(
                    ["git", "rev-parse", "--show-toplevel"],
                    cwd=source.parent,
                    capture_output=True,
                    check=True,
                )
                .stdout.decode()
                .strip()
            )
            save_proposal(
                review, proposed, Path(root) / ".aspyrus_build/review/recovery"
            )
            write_review(review, output)
            print(
                "Saved. Inspect the TEX/Canvas and git diff; rebuild/check before committing."
            )
            return True
        print("TEX unchanged; review choices retained.")
    except (EOFError, KeyboardInterrupt):
        write_review(review, output)
        print("\nReview interrupted; choices retained and TEX unchanged.")
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--current", required=True, type=Path)
    parser.add_argument("--returned", required=True, type=Path)
    parser.add_argument("--original", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument(
        "--style",
        choices=["normal", "red", "blue"],
        default="normal",
        help="Default for Accept; each change can override it",
    )
    args = parser.parse_args()
    review = compare(args.source, args.current, args.returned, args.original)
    existing = args.output / record_name("review")
    if existing.exists():
        previous = read_record(existing).get("documents", {}).get(args.source.stem)
        if previous and previous["files"] == review["files"]:
            for change in review["changes"]:
                saved = next(
                    (old for old in previous["changes"] if old["id"] == change["id"]),
                    None,
                )
                if saved:
                    change["decision"] = saved["decision"]
                    change["style"] = saved.get("style", args.style)
                    if saved.get("reason"):
                        change["reason"] = saved["reason"]
    print(review["warning"])
    print(
        f"Bibliography excluded: {review['bibliography']['baseline_paragraphs']} baseline / {review['bibliography']['returned_paragraphs']} returned paragraphs; no BibTeX edits."
    )
    if args.interactive:
        interactive_review(review, args.output, args.style)
    else:
        write_review(review, args.output)
    print(f"{len(review['changes'])} changes; read {args.output / 'review.md'}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
