from django.db import models


class Detection(models.Model):
    image = models.ImageField(upload_to='uploads/')
    timestamp = models.DateTimeField(auto_now_add=True)
    results = models.JSONField(default=dict)
    
    def __str__(self):
        return f"Detection {self.id} at {self.timestamp}"
