import re
from difflib import get_close_matches
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, List
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import uvicorn
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Toxic Text Detection API",
    description="API for detecting toxic text using pre-trained model",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load pre-trained model and tokenizer
MODEL_NAME = "unitary/toxic-bert"

try:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    print(f"Successfully loaded pre-trained model: {MODEL_NAME}")
except Exception as e:
    print(f"Error loading pre-trained model: {e}")
    raise

# Labels for the model
TOXICITY_LABELS = ["toxicity", "severe_toxicity", "obscene", "threat", "insult", "identity_attack"]

# Curated keyword lists for lightweight heuristic features
TOXIC_KEYWORDS = {
    "idiot": ["person", "individual", "colleague"],
    "stupid": ["uninformed", "mistaken", "incorrect"],
    "dumb": ["unclear", "confusing"],
    "hate": ["dislike", "prefer not to"],
    "kill": ["stop", "remove"],
    "loser": ["teammate", "peer"],
    "nasty": ["unpleasant", "difficult"],
    "trash": ["unused", "outdated"],
    "jerk": ["unhelpful person", "teammate"],
    "moron": ["person", "colleague"],
    "shut": ["please", "could you"],
    "ugly": ["unexpected", "unpolished"],
}

POLITE_REPLACEMENTS = {
    "asap": ["when you have a moment", "at your earliest convenience"],
    "now": ["soon", "when possible"],
    "immediately": ["as soon as you can"],
    "demand": ["request", "ask"],
}

COMMON_WORDS = {
    "the","be","to","of","and","a","in","that","have","i","it","for","not",
    "on","with","he","as","you","do","at","this","but","his","by","from",
    "they","we","say","her","she","or","an","will","my","one","all","would",
    "there","their","what","so","up","out","if","about","who","get","which",
    "go","me","when","make","can","like","time","no","just","him","know",
    "take","people","into","year","your","good","some","could","them","see",
    "other","than","then","now","look","only","come","its","over","think",
    "also","back","after","use","two","how","our","work","first","well",
    "way","even","new","want","because","any","these","give","day","most",
    "us","email","team","please","thanks","thank","hello","hi","regards",
    "meeting","review","update","project","share","call","message","body",
    "subject","compose","client","customer","draft","feedback","follow",
    "tomorrow","today","schedule","report","note","plan","discuss","confirm",
}

POSITIVE_WORDS = {"great", "awesome", "thanks", "thank", "appreciate", "happy", "glad", "excellent", "well"}
NEGATIVE_WORDS = {"angry", "bad", "sad", "upset", "disappointed", "frustrated", "annoyed"}


# Prediction function
def predict_toxicity(text):
    # Tokenize the input text
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
    
    # Get model prediction
    with torch.no_grad():
        outputs = model(**inputs)
        scores = torch.sigmoid(outputs.logits).squeeze().tolist()
    
    # If scores is a single value, convert to list
    if not isinstance(scores, list):
        scores = [scores]
    
    # Create result dictionary with scores for each toxicity type
    result = {
        "original_text": text,
        "is_toxic": scores[0] > 0.5,  # Main toxicity score
        "toxicity_score": scores[0],
        "detailed_scores": {}
    }
    
    # Add detailed scores if available
    if len(scores) == len(TOXICITY_LABELS):
        for i, label in enumerate(TOXICITY_LABELS):
            result["detailed_scores"][label] = scores[i]
    
    return result

# Request model
class TextRequest(BaseModel):
    text: str

# Batch request model
class BatchTextRequest(BaseModel):
    texts: List[str]

# Helper utilities
def detect_toxic_spans(text: str):
    spans = []
    for match in re.finditer(r"\b[\w']+\b", text):
        token = match.group(0)
        lower = token.lower()
        if lower in TOXIC_KEYWORDS:
            spans.append(
                {
                    "word": token,
                    "start": match.start(),
                    "end": match.end(),
                    "score": 0.95,
                    "replacement_pool": TOXIC_KEYWORDS[lower],
                }
            )
    return spans


def guess_sentiment(text: str) -> str:
    tokens = [m.group(0).lower() for m in re.finditer(r"\b[\w']+\b", text)]
    score = 0
    for token in tokens:
        if token in POSITIVE_WORDS:
            score += 1
        if token in NEGATIVE_WORDS or token in TOXIC_KEYWORDS:
            score -= 1
    if score >= 2:
        return "positive"
    if score <= -1:
        return "negative"
    return "neutral"


def build_suggestions(text: str):
    suggestions = []
    for match in re.finditer(r"\b[\w']+\b", text):
        token = match.group(0)
        lower = token.lower()
        entry = None

        if lower in TOXIC_KEYWORDS:
            entry = {
                "word": token,
                "start": match.start(),
                "end": match.end(),
                "type": "toxicity",
                "message": "This word might be perceived as toxic.",
                "replacements": TOXIC_KEYWORDS[lower],
            }
        elif lower in POLITE_REPLACEMENTS:
            entry = {
                "word": token,
                "start": match.start(),
                "end": match.end(),
                "type": "tone",
                "message": "A softer phrase could improve tone.",
                "replacements": POLITE_REPLACEMENTS[lower],
            }
        elif lower not in COMMON_WORDS and token.isalpha():
            candidates = get_close_matches(lower, COMMON_WORDS, n=2, cutoff=0.82)
            if candidates:
                entry = {
                    "word": token,
                    "start": match.start(),
                    "end": match.end(),
                    "type": "spelling",
                    "message": "Possible spelling issue.",
                    "replacements": candidates,
                }

        if entry:
            suggestions.append(entry)
    return suggestions


# Routes
@app.get("/")
def read_root():
    return {
        "message": "Welcome to the Toxic Text Detection API",
        "model": MODEL_NAME,
        "endpoints": {
            "/predict": "Analyze a single text for toxicity",
            "/predict_batch": "Analyze multiple texts for toxicity",
            "/health": "Check API health status"
        }
    }

@app.post("/predict", response_model=Dict)
def predict(request: TextRequest):
    try:
        result = predict_toxicity(request.text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@app.post("/predict_batch")
def predict_batch(request: BatchTextRequest):
    try:
        results = [predict_toxicity(text) for text in request.texts]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")

@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME}


class ToxicityRequest(BaseModel):
    text: str


class SuggestionRequest(BaseModel):
    text: str


@app.post("/predict_toxicity")
def predict_toxicity_route(request: ToxicityRequest):
    try:
        base = predict_toxicity(request.text)
        base["toxic_spans"] = detect_toxic_spans(request.text)
        base["sentiment"] = guess_sentiment(request.text)
        return base
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Toxicity endpoint error: {str(e)}")


@app.post("/suggest_words")
def suggest_words_route(request: SuggestionRequest):
    try:
        return {
            "suggestions": build_suggestions(request.text),
            "sentiment": guess_sentiment(request.text),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Suggestion endpoint error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)