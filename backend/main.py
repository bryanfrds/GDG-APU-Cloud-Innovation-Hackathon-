"""Prove It local FastAPI submission and question API."""
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile

from config import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, upload_dir
from database import get_submission, init_db, save_submission
from file_processor import ProcessingError, process_assignment
from security import one_line, protect_read, protect_upload
from routes.questions import router as questions_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title='Prove It API', description='AI-powered assignment viva system',
              version='1.1.0', lifespan=lifespan)
app.include_router(questions_router)


@app.get('/')
def root():
    return {'message': 'Welcome to Prove It API'}


@app.get('/api/health')
def health_check():
    return {'status': 'healthy', 'service': 'prove-it-backend'}


@app.post('/api/submissions', status_code=201, dependencies=[Depends(protect_upload)])
async def create_submission(title: str = Form(...), file: UploadFile = File(...)):
    try:
        clean_title = one_line(title, 120, 'Assignment title')
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    original_filename = Path(file.filename or '').name
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail='Unsupported file type')

    submission_id = uuid4().hex
    output_dir = upload_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    stored_filename = f'{submission_id}{extension}'
    destination_path = output_dir / stored_filename
    total_bytes = 0
    try:
        with destination_path.open('wb') as destination:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail='File exceeds 10 MiB')
                destination.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail='File cannot be empty')
        # Validate extractability and AI character limit now, not after upload.
        try:
            process_assignment(destination_path)
        except ProcessingError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        created_at = save_submission(
            submission_id=submission_id, title=clean_title,
            original_filename=original_filename, stored_filename=stored_filename,
            file_size_bytes=total_bytes,
        )
    except Exception:
        destination_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    return {'submission_id': submission_id, 'title': clean_title,
            'original_filename': original_filename,
            'stored_filename': stored_filename,
            'file_size_bytes': total_bytes, 'status': 'uploaded',
            'created_at': created_at}


@app.get('/api/submissions/{submission_id}', dependencies=[Depends(protect_read)])
def read_submission(submission_id: str):
    submission = get_submission(submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail='Submission not found')
    return submission


@app.get('/api/submissions/{submission_id}/content', dependencies=[Depends(protect_read)])
def read_submission_content(submission_id: str):
    submission = get_submission(submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail='Submission not found')
    filename = submission['stored_filename']
    # Store paths are never accepted from clients.
    if not (len(filename.split('.')[0]) == 32 and
            all(c in '0123456789abcdef' for c in filename.split('.')[0].lower()) and
            Path(filename).suffix.lower() in ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=500, detail='Invalid stored filename')
    try:
        result = process_assignment(upload_dir() / filename)
    except ProcessingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {'submission_id': submission_id, 'title': submission['title'],
            'original_filename': submission['original_filename'], **result}
