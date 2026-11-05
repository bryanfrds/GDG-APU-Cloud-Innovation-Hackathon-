
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, UploadFile, File, Form, HTTPException

app = FastAPI(
    title="Prove It API",
    description="AI-powered assignment viva system",
    version="1.0.0"
)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
ALLOWED_EXTENSIONS = {".pdf", ".py", ".java", ".cpp", ".txt"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@app.get("/")
def root():
    return {"message": "Welcome to Prove It API"}


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "prove-it-backend"
    }


@app.post("/api/submissions", status_code=201)
async def create_submission(
    title: str = Form(...),
    file: UploadFile = File(...)
):
    # 1. Validate assignment title
    if not title.strip():
        raise HTTPException(
            status_code=400,
            detail="Assignment title is required"
        )

    # 2. Validate file extension
    original_filename = file.filename or ""
    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type"
        )

    # 3. Generate unique submission ID
    submission_id = uuid4().hex

    # 4. Prepare local storage
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved_filename = f"{submission_id}{extension}"
    file_path = UPLOAD_DIR / saved_filename

    # 5. Save file with a size limit
    file_size = 0

    try:
        with file_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                file_size += len(chunk)

                if file_size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="File must not exceed 10 MB"
                    )

                destination.write(chunk)

        if file_size == 0:
            raise HTTPException(
                status_code=400,
                detail="File cannot be empty"
            )

    except Exception:
        file_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    # 6. Return submission information
    return {
        "submission_id": submission_id,
        "title": title.strip(),
        "original_filename": original_filename,
        "stored_filename": saved_filename,
        "file_size_bytes": file_size,
        "status": "uploaded"
    }
