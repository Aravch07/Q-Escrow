"""Bounded deterministic proposal/inspection service. Never an autonomous adjudicator."""
import io
import re
import zipfile
from pathlib import PurePosixPath
from escrow.crypto import sha256_bytes
from .accounts import HTTPError

MODE = {"mode": "deterministic_demo", "label": "Deterministic demo analysis · no external AI model"}
MAX_FILE = 2 * 1024 * 1024
MAX_EXPANDED = 12 * 1024 * 1024
FEATURES = [
 ("pages", r"\b(?:five|5)[ -]page|\b5 pages", "Five website pages", "Provide five distinct HTML pages with navigable links.", "pages"),
 ("login", r"\blog[ -]?in\b|\bsign[ -]?in\b", "User login", "Demonstrate a valid sign-in and rejection of invalid credentials.", "human"),
 ("registration", r"\bregister|\bregistration|\bsign[ -]?up", "Account registration", "Demonstrate account creation and duplicate-account validation.", "human"),
 ("contact", r"\bcontact\b", "Contact form", "Demonstrate submission, required-field validation and receipt of the message.", "human"),
 ("responsive", r"\bresponsive|\bmobile", "Responsive layout", "Review at 390px, 768px and 1440px without horizontal overflow.", "human"),
 ("admin", r"\badmin", "Admin dashboard", "Demonstrate that only an authorized administrator can open the dashboard.", "human"),
 ("payment", r"\bpayment|\bgateway|\bcheckout", "Payment gateway", "Demonstrate test checkout success and failure without real funds.", "human"),
]


def text(value, limit=12000, label="text"):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        raise HTTPError(400, f"Enter {label} using 1–{limit} characters")
    return value.strip()


class DemoAnalysis:
    mode = MODE

    def generate(self, description):
        description = text(description, label="a project description")
        found = [f for f in FEATURES if re.search(f[1], description, re.I)]
        requirements = []
        for key, _, label, criteria, method in found:
            requirements.append(dict(id=f"REQ-{len(requirements)+1:03}", description=label,
                acceptance_criteria=criteria, priority="must", verification=method,
                milestone="M1", status="proposed", check={"kind": method, "value": "5" if key == "pages" else ""}))
        if not requirements:
            for sentence in re.split(r"[\n.;]+", description)[:12]:
                if sentence.strip():
                    requirements.append(dict(id=f"REQ-{len(requirements)+1:03}", description=sentence.strip()[:400],
                        acceptance_criteria="Both parties must define an objective acceptance check before approval.",
                        priority="must", verification="human", milestone="M1", status="proposed", check={"kind":"human","value":""}))
        return {**MODE, "requirements": requirements, "complexity": "high" if len(requirements)>5 else "medium" if len(requirements)>2 else "low",
            "ambiguities": ["Page names, design references and supported browsers need agreement."] if found else ["Specify measurable acceptance criteria for each deliverable."],
            "missing_information": ["Delivery deadline", "Test data and account roles", "Revision allowance", "Hosting and third-party costs", "File format and ownership/licensing"],
            "milestone_suggestions": ["Review the brief", "Deliver implementation", "Acceptance review"],
            "notice": "All extracted requirements and estimates are proposals. Both parties must review and sign."}

    def compare(self, agreement, request):
        request = text(request, 4000, "a change request")
        changes = []
        original = agreement["requirements"]
        source = " ".join(r["description"] for r in original).lower()
        for fragment in re.split(r"\band\b|[\n;.]+", request, flags=re.I):
            fragment = fragment.strip()
            if not fragment:
                continue
            keys = [f[0] for f in FEATURES if re.search(f[1], fragment, re.I)]
            if re.search(r"\bpages?\b", fragment, re.I) and "pages" not in keys:
                keys.append("pages")
            matches = [r for r in original if any(k in r["description"].lower() for k in keys)]
            contradiction = bool(re.search(r"\b(remove|without|do not|don't|no longer)\b", fragment, re.I) and matches)
            additional = bool(re.search(r"\b(additional|extra|more|two|2|seven|7)\b", fragment, re.I))
            exact = any(fragment.lower() == r["description"].lower() for r in original)
            kind = "contradiction" if contradiction else "modification" if matches and additional else "already_included" if exact or (matches and not additional) else "new_requirement"
            if not keys and not exact:
                kind = "needs_human_review"
            changes.append({"request": fragment, "classification": kind, "related_ids": [r["id"] for r in matches],
                "explanation": "Conflicts with an existing requirement." if contradiction else "Changes the agreed quantity or implementation." if kind=="modification" else "Covered by a related requirement; confirm the details." if kind=="already_included" else "No matching signed requirement was identified; manual review is required.",
                "suggested_extra_test_eth": "0.2" if kind in ("new_requirement","modification") else "0",
                "suggested_extra_hours": 8 if kind in ("new_requirement","modification") else 0})
        return {**MODE, "base_hash": sha256_bytes(__import__('escrow.crypto',fromlist=['canonical_json']).canonical_json(agreement)),
            "changes": changes, "notice": "Heuristic comparison can miss meaning. Estimates are editable suggestions, never charges. Unchanged original requirements remain in the signed version."}


provider = DemoAnalysis()


def inspect_file(raw, filename, requirements, milestone):
    if not raw or len(raw)>MAX_FILE:
        raise HTTPError(413, "ScopeGuard inspection accepts files up to 2 MiB")
    suffix = PurePosixPath(filename).suffix.lower()
    facts = {"filename": filename, "sha256": sha256_bytes(raw), "size":len(raw), "type":suffix or "unknown"}
    texts, names, integrity = [], [], "not_checked"
    if suffix == ".zip":
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries=archive.infolist()
                if len(entries)>200 or sum(i.file_size for i in entries)>MAX_EXPANDED:
                    raise HTTPError(413, "Archive exceeds 200 entries or 12 MiB expanded data")
                if any(i.flag_bits&1 or PurePosixPath(i.filename).is_absolute() or '..' in PurePosixPath(i.filename).parts or '\\' in i.filename or ':' in i.filename for i in entries):
                    raise HTTPError(400, "Encrypted archives and unsafe paths are not supported")
                for entry in entries:
                    if entry.is_dir(): continue
                    content=archive.read(entry)  # validates CRC; never extracted or executed
                    names.append(entry.filename)
                    if PurePosixPath(entry.filename).suffix.lower() in ('.html','.css','.js','.py','.java','.txt','.md','.json'):
                        texts.append(content[:300000].decode('utf-8',errors='replace'))
            facts.update(files=names,html_pages=len([n for n in names if n.lower().endswith(('.html','.htm'))]))
            integrity="passed"
        except HTTPError: raise
        except (ValueError,zipfile.BadZipFile,RuntimeError,NotImplementedError,OSError):
            raise HTTPError(400, "Invalid, unsupported or damaged ZIP archive") from None
    elif suffix == '.pdf':
        if not raw.startswith(b'%PDF-'):
            raise HTTPError(400, "The PDF header is invalid")
        try:
            from pypdf import PdfReader
            reader=PdfReader(io.BytesIO(raw),strict=True)
            if reader.is_encrypted or len(reader.pages)>200:
                raise HTTPError(400, "Use an unencrypted PDF with at most 200 pages")
            facts['pages']=len(reader.pages)
            texts=[p.extract_text()[:20000] for p in reader.pages]
            integrity="passed"
        except ImportError:
            facts['extraction']='pypdf unavailable; PDF content requires human review'
        except HTTPError: raise
        except Exception:
            raise HTTPError(400, "This PDF could not be parsed safely") from None
    elif suffix in ('.png','.jpg','.jpeg','.webp'):
        try:
            from PIL import Image
            with Image.open(io.BytesIO(raw)) as image:
                if image.width*image.height>16_000_000: raise HTTPError(413,"Image exceeds 16 megapixels")
                facts.update(width=image.width,height=image.height,format=image.format)
                expected={'.png':'PNG','.jpg':'JPEG','.jpeg':'JPEG','.webp':'WEBP'}
                if image.format != expected[suffix]: raise HTTPError(400,"Image content does not match the filename")
                image.verify()
            integrity="passed"
        except HTTPError: raise
        except Exception: raise HTTPError(400,"Invalid or damaged image") from None
    elif suffix in ('.txt','.md','.py','.java','.html','.css','.js','.json','.csv'):
        try: texts=[raw.decode('utf-8')]
        except UnicodeDecodeError: raise HTTPError(400,"This text file is not valid UTF-8") from None
        integrity="passed"
    else:
        facts['inspection']='Opaque file: fingerprint recorded; content needs human review'
    facts['integrity']=integrity
    content='\n'.join(texts).lower()
    results=[]
    for req in requirements:
        if req['milestone']!=milestone: continue
        kind,value=req['check']['kind'],req['check']['value']
        result='NEEDS_HUMAN_REVIEW'
        evidence='No automated behavioral or quality test was performed. Review the agreed acceptance criteria.'
        if kind=='pages' and 'html_pages' in facts:
            result='PASSED' if facts['html_pages']>=int(value) else 'FAILED'
            evidence=f"Found {facts['html_pages']} HTML files; required at least {value}. This checks file count, not navigation or behavior."
        elif kind=='pdf_pages' and 'pages' in facts:
            result='PASSED' if facts['pages']>=int(value) else 'FAILED'
            evidence=f"Parsed {facts['pages']} pages; required at least {value}."
        elif kind=='file' and names:
            result='PASSED' if value in names else 'FAILED'
            evidence=f"Required archive path: {value}. Exact path {'present' if result=='PASSED' else 'absent'}."
        elif kind=='keyword' and texts:
            present=value.lower() in content
            evidence=f"Literal text '{value}' {'found' if present else 'not found'} in extracted text. Presence alone does not prove functionality or semantic correctness."
            result='NEEDS_HUMAN_REVIEW' if present else 'FAILED'
        elif kind=='image_min' and 'width' in facts:
            w,h=map(int,value.split('x'))
            result='PASSED' if facts['width']>=w and facts['height']>=h else 'FAILED'
            evidence=f"Decoded dimensions {facts['width']}×{facts['height']}; minimum {w}×{h}."
        results.append({'requirement_id':req['id'],'status':result,'evidence':evidence})
    return {**MODE,'facts':facts,'results':results,'warning':'SHA-256 identifies bytes, not correctness. Source code was never executed. Human review is required before approval.'}
