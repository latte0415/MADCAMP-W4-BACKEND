import cv2
import json
import argparse
import mediapipe as mp

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils


def overlay_motion_events(video_path, json_path, out_path):
    with open(json_path, "r") as f:
        data = json.load(f)

    hit_frames = set(
        ev["frame"] for ev in data["events"] if ev["type"] == "hit"
    )

    hold_ranges = [
        (ev["start_frame"], ev["end_frame"])
        for ev in data["events"] if ev["type"] == "hold"
    ]

    def in_hold(frame):
        return any(s <= frame <= e for s, e in hold_ranges)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Cannot open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    out = cv2.VideoWriter(
        out_path,
        cv2.VideoWriter_fourcc(*"avc1"),
        fps,
        (w, h)
    )

    pose = mp_pose.Pose()

    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)

        if res.pose_landmarks:
            mp_drawing.draw_landmarks(
                frame,
                res.pose_landmarks,
                mp_pose.POSE_CONNECTIONS
            )

        if frame_idx in hit_frames:
            cv2.putText(
                frame, "HIT",
                (40, 70),
                cv2.FONT_HERSHEY_SIMPLEX,
                2.0,
                (0, 0, 255),
                4
            )

        if in_hold(frame_idx):
            cv2.putText(
                frame, "HOLD",
                (40, 130),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.5,
                (255, 180, 0),
                3
            )

        out.write(frame)
        frame_idx += 1

    cap.release()
    out.release()
    pose.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    overlay_motion_events(args.video, args.json, args.out)
    print(f"Saved overlay video to {args.out}")
