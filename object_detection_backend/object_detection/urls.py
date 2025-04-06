# object_detection/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('detect/', views.detect_objects, name='detect_objects'),
    path('settings/', views.update_settings, name='update_settings'),
]
