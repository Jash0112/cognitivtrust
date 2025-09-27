import os

API_KEY = os.environ.get("API_KEY")
def fetch_data(): 
    print("Using API key:", API_KEY) 