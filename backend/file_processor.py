"""Bounded text extraction for supported submission formats."""
from pathlib import Path
from pypdf import PdfReader
from config import AI_CHAR_LIMIT

SUPPORTED_CODE_EXTENSIONS = {'.py', '.java', '.cpp', '.txt'}
MAX_PDF_PAGES = 50


class ProcessingError(Exception):
    pass


def extract_code(file_path: Path) -> str:
    try:
        content = file_path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError) as error:
        raise ProcessingError('File must contain readable UTF-8 text') from error
    if not content.strip():
        raise ProcessingError('Assignment contains no readable text')
    return content


def extract_pdf(file_path: Path) -> str:
    try:
        reader = PdfReader(str(file_path))
        if reader.is_encrypted:
            raise ProcessingError('Encrypted PDFs are unsupported')
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ProcessingError('PDF exceeds 50 pages')
        pages = []
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if text.strip():
                pages.append(f'[Page {number}]\n{text}')
        content = '\n\n'.join(pages)
    except ProcessingError:
        raise
    except Exception as error:
        raise ProcessingError('Unable to extract PDF text') from error
    if not content.strip():
        raise ProcessingError('No selectable PDF text found')
    return content


def process_assignment(file_path: Path):
    if not file_path.is_file():
        raise ProcessingError('Assignment file not found')
    extension = file_path.suffix.lower()
    if extension == '.pdf':
        content = extract_pdf(file_path)
    elif extension in SUPPORTED_CODE_EXTENSIONS:
        content = extract_code(file_path)
    else:
        raise ProcessingError('Unsupported assignment format')
    if len(content) > AI_CHAR_LIMIT:
        raise ProcessingError('Extracted assignment exceeds 30,000 characters')
    return {'file_type': extension, 'character_count': len(content),
            'line_count': len(content.splitlines()), 'content': content}
