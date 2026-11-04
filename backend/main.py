
from fastapi import FastAPI

app = FastAPI(
    title="Prove It API",
    description="AI-powered assignment viva system",
    version="1.0.0"
)


@app.get("/")
def root():
    return {
        "message": "Welcome to Prove It API"
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "prove-it-backend"
    }
