from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
import cv2
import numpy as np
from fgi_eye_tracker import EyeTracker
import uvicorn

app = FastAPI()
tracker = EyeTracker(device="cpu")

@app.post("/estimate")
async def estimate(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if frame is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    frame = cv2.flip(frame, 1)
    result = tracker.estimate(frame)
    
    return {
        "direction": result.direction,
        "both_eyes_facing": result.both_eyes_facing,
        "calib_ready": result.calib_ready,
        "left_xy": result.left_xy,
        "right_xy": result.right_xy,
        "calib_progress": result.calib_progress
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5002)
