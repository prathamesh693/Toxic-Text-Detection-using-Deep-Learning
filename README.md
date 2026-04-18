
# Toxic Text Detector using Deep Learning

A toxicity detection project that combines a FastAPI backend, a Hugging Face toxic-text model, a web demo, and a Chrome extension for real-time toxic text monitoring.

## Overview

This repository includes:
- `main.py`: FastAPI app serving a toxic text detection API using the pre-trained model `unitary/toxic-bert`
- `static/`: Web UI demo for text analysis and feedback
- `chrome-extension/`: Manifest V3 Chrome extension that detects toxic text live while typing and proxies requests to the local API
- `Machine Learning/`: Notebooks and training artifacts used during model exploration and development

The project is designed for moderation, content quality control, and safe communication by identifying toxicity, insults, threats, and rude language.

## Key Features

- Real-time toxicity detection via a FastAPI backend
- Multi-label toxicity scoring across categories:
  - `toxicity`
  - `severe_toxicity`
  - `obscene`
  - `threat`
  - `insult`
  - `identity_attack`
- Web demo interface for fast testing
- Chrome extension with highlight styles, badge alerts, and API health checks
- Suggestion endpoint for tone and spelling improvements
- Local model serving with `unitary/toxic-bert`

## Repository Structure

```
.
├── README.md
├── main.py
├── requirements.txt
├── static/
│   ├── index.html
│   ├── script.js
│   ├── styles.css
├── chrome-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── style.css
└── Machine Learning/
    ├── Data_Exploration.ipynb
    ├── Data_Preprocessing.ipynb
    ├── model_training.ipynb
    ├── preprocessed_text.csv
    ├── train.csv
    └── LSTM_toxic_prediction_model.h5
```

## Prerequisites

- Python 3.7+
- `pip`
- Internet access for downloading the Hugging Face model on first run

## Installation

1. Open a terminal in the project folder:
   ```bash
   cd "R:\Projects\2_Deep_Learning_Projects\Toxic Text Detector using Deep Learning"
   ```

2. Create and activate a virtual environment (recommended):
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the API

Start the FastAPI server:

```bash
python main.py
```

The app launches on:

- `http://localhost:8000`
- `http://localhost:8000/static/index.html` for the web demo
- `http://localhost:8000/docs` for interactive API docs

## API Endpoints

### `GET /`
Returns a welcome message and endpoint summary.

### `GET /health`
Returns health status and model metadata.

### `POST /predict`
Analyze a single text for toxicity.

Request body:

```json
{ "text": "Your text here" }
```

### `POST /predict_batch`
Analyze multiple texts in one request.

Request body:

```json
{ "texts": ["Text one", "Text two"] }
```

### `POST /predict_toxicity`
Returns toxicity scores plus toxic spans and sentiment.

### `POST /suggest_words`
Returns tone and spelling suggestions based on text input.

## Web Demo

Open `http://localhost:8000/static/index.html` in your browser to test the app locally. The demo provides:

- live toxicity scoring
- sentiment feedback
- detected toxic words
- suggested improvements
- detailed per-label scores

## Chrome Extension

The Chrome extension is located in `chrome-extension/` and is built to work with the local API.

### Install the extension

1. Start the API server: `python main.py`
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `chrome-extension/` folder
6. Pin the extension if desired

### What it does

- monitors text fields on web pages
- highlights toxic text in real time
- updates badge state for toxic detection
- shows API health status in the popup
- remembers highlight style and pause state

## Notes

- The current backend uses `unitary/toxic-bert` from Hugging Face.
- The `Machine Learning/` folder contains the original training notebooks and the legacy LSTM artifact.
- The extension uses a service worker proxy to send requests to `http://localhost:8000` and avoid CORS issues.

## Troubleshooting

- If the extension shows API offline, make sure `python main.py` is running.
- If the model takes time to respond on first launch, allow a short warm-up for the transformer model.
- For any dependency issues, verify that `requirements.txt` is installed in the active environment.

## Dependencies

Core packages in `requirements.txt`:

- `fastapi`
- `uvicorn`
- `transformers`
- `torch`
- `pydantic`
- `python-multipart`

## License

This repository is intended for educational and experimentation purposes.
