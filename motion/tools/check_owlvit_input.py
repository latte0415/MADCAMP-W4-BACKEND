from transformers import OwlViTProcessor

p = OwlViTProcessor.from_pretrained("google/owlvit-base-patch32")
print("size:", p.image_processor.size)
print("crop_size:", getattr(p.image_processor, "crop_size", None))