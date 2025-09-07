"""
POSPal Configuration Management
Loads environment variables and provides secure defaults
"""
import os

# Try to load environment variables from .env.local file
try:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
except ImportError:
    # dotenv not available, fallback to system environment variables only
    print("Warning: python-dotenv not available. Using system environment variables only.")
except Exception as e:
    # .env.local file might not exist or have issues, continue without it
    print(f"Warning: Could not load .env.local file: {e}")
    pass

class Config:
    # Flask Configuration
    SECRET_KEY = os.environ.get('FLASK_SECRET_KEY') or 'dev-secret-key-change-in-production'
    DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'
    
    # Stripe Configuration
    STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY')
    STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY') 
    STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET')
    
    # Cloudflare Configuration
    CLOUDFLARE_API_TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
    CLOUDFLARE_ACCOUNT_ID = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    CLOUDFLARE_WORKER_URL = os.environ.get('CLOUDFLARE_WORKER_URL')
    CLOUDFLARE_D1_DATABASE_ID = os.environ.get('CLOUDFLARE_D1_DATABASE_ID')
    
    # Email Configuration
    EMAIL_SERVICE = os.environ.get('EMAIL_SERVICE', 'mailgun')
    MAILGUN_API_KEY = os.environ.get('MAILGUN_API_KEY')
    MAILGUN_DOMAIN = os.environ.get('MAILGUN_DOMAIN')
    
    # Application Configuration
    APP_BASE_URL = os.environ.get('APP_BASE_URL', 'http://localhost:5000')
    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
    
    # Security Configuration
    LICENSE_VALIDATION_SECRET = os.environ.get('LICENSE_VALIDATION_SECRET')
    HARDWARE_ID_SALT = os.environ.get('HARDWARE_ID_SALT')
    SESSION_TIMEOUT = int(os.environ.get('SESSION_TIMEOUT', 3600))
    MAX_LOGIN_ATTEMPTS = int(os.environ.get('MAX_LOGIN_ATTEMPTS', 5))
    
    # Rate Limiting
    RATE_LIMIT_PER_MINUTE = int(os.environ.get('RATE_LIMIT_PER_MINUTE', 60))
    RATE_LIMIT_PER_HOUR = int(os.environ.get('RATE_LIMIT_PER_HOUR', 1000))
    
    # Feature Flags
    ENABLE_TEST_MODE = os.environ.get('ENABLE_TEST_MODE', 'true').lower() == 'true'
    ENABLE_NEW_CHECKOUT = os.environ.get('ENABLE_NEW_CHECKOUT', 'true').lower() == 'true'
    ENABLE_SUBSCRIPTION_MANAGEMENT = os.environ.get('ENABLE_SUBSCRIPTION_MANAGEMENT', 'true').lower() == 'true'
    ENABLE_REFUND_PROCESSING = os.environ.get('ENABLE_REFUND_PROCESSING', 'true').lower() == 'true'
    ENABLE_EMAIL_NOTIFICATIONS = os.environ.get('ENABLE_EMAIL_NOTIFICATIONS', 'true').lower() == 'true'
    
    @staticmethod
    def validate_config():
        """Validate that all required environment variables are set"""
        required_vars = [
            'STRIPE_PUBLISHABLE_KEY',
            'STRIPE_SECRET_KEY', 
            'CLOUDFLARE_WORKER_URL'
        ]
        
        missing_vars = []
        for var in required_vars:
            if not getattr(Config, var):
                missing_vars.append(var)
        
        if missing_vars:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
        
        return True
    
    @staticmethod
    def get_stripe_keys():
        """Get Stripe keys with validation"""
        if not Config.STRIPE_PUBLISHABLE_KEY or not Config.STRIPE_SECRET_KEY:
            raise ValueError("Stripe keys not configured. Please set STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY in .env.local")
        
        return {
            'publishable_key': Config.STRIPE_PUBLISHABLE_KEY,
            'secret_key': Config.STRIPE_SECRET_KEY,
            'webhook_secret': Config.STRIPE_WEBHOOK_SECRET
        }