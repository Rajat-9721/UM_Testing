// Sticky Header
const header = document.getElementById('main-header');
window.addEventListener('scroll', () => {
  if (window.scrollY > 10) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
});

// Hero Carousel
const carouselInner = document.getElementById('carouselInner');
const carouselControls = document.getElementById('carouselControls');
const slides = document.querySelectorAll('.carousel-slide');
const totalSlides = slides.length;
let currentSlide = 0;
let carouselInterval;

// Initialize dots
slides.forEach((_, index) => {
  const dot = document.createElement('div');
  dot.classList.add('carousel-dot');
  if (index === 0) dot.classList.add('active');
  dot.addEventListener('click', () => goToSlide(index));
  carouselControls.appendChild(dot);
});

const dots = document.querySelectorAll('.carousel-dot');

function updateDots() {
  dots.forEach(dot => dot.classList.remove('active'));
  dots[currentSlide].classList.add('active');
}

function goToSlide(index) {
  currentSlide = index;
  carouselInner.style.transform = `translateX(-${currentSlide * 100}%)`;
  updateDots();
  resetInterval();
}

function nextSlide() {
  currentSlide = (currentSlide + 1) % totalSlides;
  goToSlide(currentSlide);
}

function startInterval() {
  carouselInterval = setInterval(nextSlide, 4500); // 4.5 seconds
}

function resetInterval() {
  clearInterval(carouselInterval);
  startInterval();
}

// Pause on hover
const heroCarousel = document.getElementById('heroCarousel');
heroCarousel.addEventListener('mouseenter', () => clearInterval(carouselInterval));
heroCarousel.addEventListener('mouseleave', startInterval);

startInterval();

// Course Data (Fallback if Supabase is not configured yet)
const fallbackCoursesData = {
  popular: [
    { title: "Data Science Certification", faculty: "Pranav Nerurkar", mode: "Online/Offline", badge: "Bestseller", img: "assets/course.jpg" },
    { title: "Professional AI Certification", faculty: "Dr. Bhalchandra Chaudhari", mode: "Online · Weekend", badge: "Top Rated", img: "assets/course.jpg" },
    { title: "Machine Learning Masterclass", faculty: "Palash Ingle", mode: "Online/Offline", badge: "Trending", img: "assets/course.jpg" },
    { title: "Python Programming Basics", faculty: "Sanjeev Singh", mode: "Online/Offline", badge: "New Batch", img: "assets/course.jpg" }
  ],
  datascience: [
    { title: "Data Science Certification", faculty: "Pranav Nerurkar", mode: "Online/Offline", badge: "Bestseller", img: "assets/course.jpg" },
    { title: "Machine Learning Masterclass", faculty: "Palash Ingle", mode: "Online/Offline", badge: "Trending", img: "assets/course.jpg" },
    { title: "Deep Learning Specialization", faculty: "Utkarsh Minds Team", mode: "Online/Offline", badge: "", img: "assets/course.jpg" }
  ],
  ai: [
    { title: "Professional AI Certification", faculty: "Dr. Bhalchandra Chaudhari", mode: "Online · Weekend", badge: "Top Rated", img: "assets/course.jpg" },
    { title: "Generative AI Bootcamp", faculty: "Expert Panel", mode: "Online", badge: "Trending", img: "assets/course.jpg" },
    { title: "NLP & Computer Vision", faculty: "Utkarsh Minds Team", mode: "Online/Offline", badge: "", img: "assets/course.jpg" }
  ],
  foundation: [
    { title: "Python Programming Basics", faculty: "Sanjeev Singh", mode: "Online/Offline", badge: "", img: "assets/course.jpg" },
    { title: "Statistics for Python", faculty: "Expert Panel", mode: "Online", badge: "Starts Soon", img: "assets/course.jpg" },
    { title: "Foundation in Data Analytics", faculty: "Utkarsh Minds Team", mode: "Online/Offline", badge: "New Batch", img: "assets/course.jpg" }
  ]
};

// Course Tabs Logic
const tabBtns = document.querySelectorAll('.tab-btn');
const coursesContainer = document.getElementById('coursesContainer');

async function renderCourses(category) {
  coursesContainer.innerHTML = '<div style="text-align:center; width:100%; color:var(--text-gray);">Loading courses...</div>';
  
  let courses = [];
  
  try {
    // Attempt to fetch from Supabase
    if (typeof supabase !== 'undefined' && supabase.supabaseUrl !== 'YOUR_SUPABASE_URL_HERE') {
      let query = supabase.from('courses').select('*');
      if (category !== 'popular') {
        query = query.eq('category', category);
      } else {
        query = query.limit(4);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      if (data && data.length > 0) {
        courses = data;
      } else {
        throw new Error("No data found in Supabase for this category.");
      }
    } else {
      throw new Error("Supabase not configured properly.");
    }
  } catch (error) {
    console.warn("Falling back to local data:", error.message);
    courses = fallbackCoursesData[category] || [];
  }
  
  coursesContainer.innerHTML = '';
  
  if (courses.length === 0) {
    coursesContainer.innerHTML = '<div style="text-align:center; width:100%; color:var(--text-gray);">No courses found.</div>';
    return;
  }
  
  courses.forEach(course => {
    const card = document.createElement('div');
    card.classList.add('course-card');
    
    let badgeHTML = '';
    if (course.badge) {
      badgeHTML = `<div class="badge">${course.badge}</div>`;
    }
    
    // Determine the ID to pass to course-details.html (fallback data has no ID)
    const detailUrl = course.id ? `course-details.html?id=${course.id}` : '#';
    
    card.innerHTML = `
      <div class="course-img">
        ${badgeHTML}
        <img src="${course.img || 'assets/course.jpg'}" alt="${course.title}">
      </div>
      <div class="course-content">
        <h3 class="course-title">${course.title}</h3>
        <div class="course-meta">
          <span><strong>Faculty:</strong> ${course.faculty || 'Expert Panel'}</span>
          <span><strong>Mode:</strong> ${course.mode || 'Online'}</span>
        </div>
        <div class="course-price-row">
          <a href="${detailUrl}" class="btn btn-accent" style="width: 100%;">View Details</a>
        </div>
      </div>
    `;
    coursesContainer.appendChild(card);
  });
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class
    tabBtns.forEach(b => b.classList.remove('active'));
    // Add active class
    btn.classList.add('active');
    // Render courses
    renderCourses(btn.dataset.target);
  });
});

// Initial Render
renderCourses('popular');
