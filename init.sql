-- Supabase Database Initialization Script

-- 1. Create the Courses Table
CREATE TABLE IF NOT EXISTS public.courses (
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
DROP POLICY IF EXISTS "Courses are viewable by everyone" ON public.courses;
CREATE POLICY "Courses are viewable by everyone" ON public.courses FOR SELECT USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS courses_title_unique ON public.courses (title);

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
)
ON CONFLICT (title) DO NOTHING;

-- 4. User Roles (Assuming Supabase Auth is used)
-- We will use the 'raw_user_meta_data' in auth.users to store { "role": "student" } or { "role": "assistant" }

-- 5. Student profiles and purchased courses
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'assistant')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.enrollments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (student_id, course_id)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view their profile" ON public.profiles;
CREATE POLICY "Students can view their profile" ON public.profiles
    FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "Students can view their enrollments" ON public.enrollments;
CREATE POLICY "Students can view their enrollments" ON public.enrollments
    FOR SELECT USING (student_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_student(
    student_id UUID,
    student_email TEXT,
    purchased_course_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') <> 'assistant' THEN
        RAISE EXCEPTION 'Only assistants can register students';
    END IF;

    INSERT INTO public.profiles (id, email, role)
    VALUES (student_id, lower(student_email), 'student')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

    IF purchased_course_id IS NOT NULL THEN
        INSERT INTO public.enrollments (student_id, course_id)
        VALUES (student_id, purchased_course_id)
        ON CONFLICT (student_id, course_id) DO NOTHING;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_student(UUID, TEXT, UUID) TO authenticated;

-- Supports assigning both Data Science and AI/ML courses at registration time.
DROP FUNCTION IF EXISTS public.register_student_courses(UUID, TEXT, UUID[]);
CREATE OR REPLACE FUNCTION public.register_student_courses(
    p_student_id UUID,
    p_student_email TEXT,
    p_purchased_course_ids UUID[] DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') <> 'assistant' THEN
        RAISE EXCEPTION 'Only assistants can register students';
    END IF;

    INSERT INTO public.profiles (id, email, role)
    VALUES (p_student_id, lower(p_student_email), 'student')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

    INSERT INTO public.enrollments (student_id, course_id)
    SELECT p_student_id, selected_courses.course_id
    FROM unnest(p_purchased_course_ids) AS selected_courses(course_id)
    ON CONFLICT (student_id, course_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_student_courses(UUID, TEXT, UUID[]) TO authenticated;
