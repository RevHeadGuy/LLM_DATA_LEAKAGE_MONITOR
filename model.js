// TensorFlow.js model for sensitive data detection
class SensitiveDataModel {
    constructor() {
        this.model = null;
        this.tokenizer = null;
        this.isModelLoaded = false;
    }

    async loadModel() {
        try {
            // Load the model
            this.model = await tf.loadLayersModel('model/model.json');
            
            // Initialize tokenizer
            this.tokenizer = new Map();
            const commonTokens = [
                'api', 'key', 'token', 'secret', 'password', 'credential',
                'gsk_', 'sk_', 'pk_', 'aws_', 'private', 'public',
                'begin', 'end', 'certificate', 'ssh', 'rsa', 'dsa'
            ];
            
            commonTokens.forEach((token, index) => {
                this.tokenizer.set(token, index + 1);
            });
            
            this.isModelLoaded = true;
            console.log('Model loaded successfully');
        } catch (error) {
            console.error('Error loading model:', error);
        }
    }

    preprocessText(text) {
        // Convert text to lowercase
        text = text.toLowerCase();
        
        // Tokenize the text
        const tokens = text.split(/[\s_\-\.]+/);
        
        // Convert tokens to numbers using the tokenizer
        const sequence = tokens.map(token => this.tokenizer.get(token) || 0);
        
        // Pad or truncate to fixed length (e.g., 50 tokens)
        const maxLength = 50;
        while (sequence.length < maxLength) {
            sequence.push(0);
        }
        if (sequence.length > maxLength) {
            sequence.length = maxLength;
        }
        
        return tf.tensor2d([sequence]);
    }

    async predict(text) {
        if (!this.isModelLoaded) {
            await this.loadModel();
        }

        try {
            // Preprocess the input text
            const inputTensor = this.preprocessText(text);
            
            // Make prediction
            const prediction = await this.model.predict(inputTensor).data();
            
            // Clean up tensors
            inputTensor.dispose();
            
            // Return prediction score (probability of being sensitive data)
            return prediction[0];
        } catch (error) {
            console.error('Error making prediction:', error);
            return 0;
        }
    }

    // Rule-based fallback for when model is not loaded
    fallbackDetection(text) {
        const patterns = {
            'apiKey': /(api[_-]?key|apikey|api[_-]?token|apitoken)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.]{20,})['"]?/gi,
            'awsKey': /(aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)[\s]*[=:]\s*['"]?([A-Z0-9]{20,})['"]?/gi,
            'privateKey': /(-----BEGIN[_-]?PRIVATE[_-]?KEY-----[\s\S]*?-----END[_-]?PRIVATE[_-]?KEY-----)/gi,
            'password': /(password|passwd|pwd)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.@#$%^&*]{8,})['"]?/gi,
            'jwt': /(eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)/g,
            'standaloneApiKey': /(gsk_[a-zA-Z0-9]{32,}|sk_[a-zA-Z0-9]{32,}|pk_[a-zA-Z0-9]{32,}|[a-zA-Z0-9_\-\.]{20,})/g
        };

        for (const [type, pattern] of Object.entries(patterns)) {
            if (pattern.test(text)) {
                return true;
            }
        }
        return false;
    }
}

// Create and export model instance
const sensitiveDataModel = new SensitiveDataModel();
export default sensitiveDataModel; 