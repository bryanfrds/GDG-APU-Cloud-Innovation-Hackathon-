
from pathlib import Path

from pypdf import PdfReader


SUPPORTED_CODE_EXTENSIONS = {
    ".py", ".java", ".cpp", ".txt"
}

MAX_PDF_PAGES = 50
MAX_EXTRACTED_CHARS = 100_000


class ProcessingError(Exception):
    pass


def extract_code(file_path: Path):
    """Read a source code or text file."""

    try:
        content = file_path.read_text(encoding="utf-8")

    except UnicodeDecodeError:
        raise ProcessingError(
            "File must use UTF-8 text encoding."
        )

    except OSError:
        raise ProcessingError(
            "Unable to read the assignment file."
        )

    if not content.strip():
        raise ProcessingError(
            "Assignment contains no readable text."
        )

    return content


def extract_pdf(file_path: Path):
    """Extract selectable text from a PDF."""

    try:
        reader = PdfReader(str(file_path))

        if reader.is_encrypted:
            raise ProcessingError(
                "Password-protected PDFs are not supported."
            )

        if len(reader.pages) > MAX_PDF_PAGES:
            raise ProcessingError(
                "PDF exceeds the 50-page processing limit."
            )

        pages = []

        for page_number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""

            if text.strip():
                pages.append(
                    f"[Page {page_number}]\n{text}"
                )

        content = "\n\n".join(pages)

    except ProcessingError:
        raise

    except Exception:
        raise ProcessingError(
            "Unable to extract text from this PDF."
        )

    if not content.strip():
        raise ProcessingError(
            "No selectable text found. "
            "Scanned PDFs are not yet supported."
        )

    return content


def process_assignment(file_path: Path):
    """Extract file content for later AI analysis."""

    if not file_path.is_file():
        raise ProcessingError(
            "Assignment file not found."
        )

    extension = file_path.suffix.lower()

    if extension == ".pdf":
        content = extract_pdf(file_path)

    elif extension in SUPPORTED_CODE_EXTENSIONS:
        content = extract_code(file_path)

    else:
        raise ProcessingError(
            "Unsupported assignment file format."
        )

    if len(content) > MAX_EXTRACTED_CHARS:
        raise ProcessingError(
            "Extracted content exceeds the processing limit."
        )

    return {
        "file_type": extension,
        "character_count": len(content),
        "line_count": len(content.splitlines()),
        "content": content
    }
