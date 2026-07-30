-- Supabase Database Initialization Script

-- 1. Create the Courses Table
CREATE TABLE public.courses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- e.g., 'datascience', 'ai', 'foundation', 'popular'
    faculty VARCHAR(255),
    mode VARCHAR(100),
    badge VARCHAR(50),
    price DECIMAL(10, 2),
    description TEXT,
    img VARCHAR(255) DEFAULT 'assets/course.jpg',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Set up Row Level Security (RLS) for courses
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

-- Allow public read access to courses
CREATE POLICY "Courses are viewable by everyone" ON public.courses FOR SELECT USING (true);

-- 3. Insert Initial Scraped Data from Utkarsh Minds
INSERT INTO public.courses (title, category, faculty, mode, badge, price, description) VALUES
(
    'Tier-I Engineer: Intro to AI & Machine Learning',
    'ai',
    'Sanjeev Singh, Pranav Nerurkar, Palash Ingle',
    'Online/Offline',
    'Beginner Friendly',
    4000.00,
    'Embark on a captivating journey into the realm of Artificial Intelligence. Delve into the history, impactful applications, and ethical landscape. Grasp basic algorithms such as linear regression, logistic regression, and k-nearest neighbors. Acquire essential programming skills in Python leveraging NumPy, Pandas, and Matplotlib.'
),
(
    'Tier-II Engineer: Applied Machine Learning',
    'datascience',
    'Sanjeev Singh, Pranav Nerurkar, Palash Ingle',
    'Online/Offline',
    'Most Popular',
    30000.00,
    'Elevate your understanding of advanced supervised learning algorithms (SVM, Decision Trees, Random Forests). Dive into unsupervised learning and clustering. Master data handling, NLP with NLTK and spaCy, Computer Vision with OpenCV, and basic Reinforcement Learning.'
),
(
    'Tier-III Engineer: Advanced Deep Learning',
    'ai',
    'Sanjeev Singh, Pranav Nerurkar, Palash Ingle',
    'Online/Offline',
    'Advanced',
    55000.00,
    'Unleash the power of deep learning frameworks like TensorFlow and PyTorch. Explore CNNs, RNNs, LSTMs, GANs, and VAEs. Elevate your AI capabilities with insights into distributed computing, GPU acceleration, NLP mechanisms (BERT, GPT), and Robotics.'
),
(
    'Professional Certification in Artificial Intelligence',
    'ai',
    'Dr. Bhalchandra Chaudhari & Team',
    'Online · Weekend',
    'Top Rated',
    NULL,
    '200-HR Weekend batches. Live online certification course covering Python, Machine Learning, Deep Learning, NLP, Generative AI, Computer Vision, Power BI, and Big Data. 100% placement assistance.'
),
(
    'Data Science Certification',
    'datascience',
    'Pranav Nerurkar',
    'Online/Offline',
    'Bestseller',
    NULL,
    'Students explore the interdisciplinary field of data science, covering fundamental concepts such as classification and regression within machine learning, delving into artificial intelligence and its subset.'
),
(
    'Python Programming Basics',
    'foundation',
    'Sanjeev Singh',
    'Online/Offline',
    'New Batch',
    NULL,
    'Start your coding journey with foundational Python programming.'
);

-- 4. User Roles (Assuming Supabase Auth is used)
-- We will use the 'raw_user_meta_data' in auth.users to store { "role": "student" } or { "role": "assistant" }
