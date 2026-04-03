
# Toxic-Text-Detection
Toxic texts and abuses can affect a person mentally. In order to tackle that I have developed this project.

This repository consists of a web application which can classify between toxic and non-toxic texts. It uses advanced deep learning models to classify the text.

## Live Demo

Once you've set up the project following the installation instructions below, you can access the live demo at:
- http://localhost:8000/static/index.html

The web interface allows you to:
- Enter any text to analyze
- Get instant toxicity detection results
- View detailed toxicity scores across multiple categories

## Dataset

The dataset was acquired from **Kaggle's Toxic Comment Classification Challenge**. <br>
**Link:** https://www.kaggle.com/c/jigsaw-toxic-comment-classification-challenge/data

## Implementation Options

### 1. Custom LSTM Model
The project initially used a deep learning LSTM model for classification of text. This custom model has an accuracy of **96%** on test data.

### 2. Pre-trained Transformer Model (New)
The project now also supports using a pre-trained transformer model from Hugging Face (`unitary/toxic-bert`). This model provides:
- More detailed toxicity analysis (toxicity, severe toxicity, obscene, threat, insult, identity attack)
- State-of-the-art performance without additional training
- Regular updates from the model provider

## API Service
The project now includes a FastAPI implementation that allows you to use the toxic text detection model as an API service. This enables integration with:
- Chat applications
- Content moderation systems
- Social media platforms
- Games and interactive applications

### API Endpoints
- `/predict` - Analyze a single text for toxicity
- `/predict_batch` - Analyze multiple texts at once
- `/health` - Check API health status
- Web interface at `/static/index.html` for easy testing

## Repository Details:
- **Machine Learning folder**: Contains all the operations performed to build the original LSTM model, including data exploration, preprocessing, and model training.
- **main.py**: FastAPI implementation for serving the pre-trained model.
- **static folder**: Contains the web interface for testing the API.
- **requirements.txt**: Lists all dependencies needed to run the API.

## How to Run This Project

### Prerequisites
- Python 3.7 or higher
- pip (Python package installer)

### Installation and Setup
1. Clone this repository or download it as a ZIP file:
   ```bash
   git 
   cd Toxic-Text-Detection
   ```

2. Create and activate a virtual environment (optional but recommended):
   ```bash
   # On Windows
   python -m venv venv
   venv\Scripts\activate

   # On macOS/Linux
   python -m venv venv
   source venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Running the FastAPI Application
1. Start the FastAPI server:
   ```bash
   python main.py
   ```
   The server will start at http://localhost:8000

2. Access the application:
   - Web interface: http://localhost:8000/static/index.html
   - API documentation: http://localhost:8000/docs
   - API endpoints directly: http://localhost:8000/predict (POST request)

### Using the API
1. Using the web interface:
   - Open http://localhost:8000/static/index.html in your browser
   - Enter text in the input field
   - Click "Check Text" to analyze

2. Using the API directly (with curl):
   ```bash
   curl -X POST "http://localhost:8000/predict" -H "Content-Type: application/json" -d "{\"text\":\"Your text to analyze\"}"
   ```

3. Using the batch API (for multiple texts):
   ```bash
   curl -X POST "http://localhost:8000/predict_batch" -H "Content-Type: application/json" -d "{\"texts\":[\"First text\", \"Second text\"]}"
   ```

### Running the Original LSTM Model (Optional)
If you want to use the original LSTM model instead of the pre-trained model:

1. Modify the `main.py` file to use the LSTM model:
   - Comment out the Hugging Face model loading code
   - Uncomment the LSTM model loading code
   - Update the prediction function to use the LSTM model

2. Run the application as described above

## Notes
- The original LSTM model was designed as a multilabel classifier but simplified to binary classification due to label bias issues.
- The pre-trained model provides more detailed toxicity categories while maintaining high accuracy.
