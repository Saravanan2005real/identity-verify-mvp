import urllib.request
import os

url = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
dest = os.path.join(os.path.dirname(__file__), "sface.onnx")

headers = {'User-Agent': 'Mozilla/5.0'}
req = urllib.request.Request(url, headers=headers)

print("Downloading SFace ONNX model...")
with urllib.request.urlopen(req) as resp, open(dest, 'wb') as out_file:
    out_file.write(resp.read())

print(f"Downloaded SFace ONNX model successfully: {os.path.getsize(dest)} bytes")
