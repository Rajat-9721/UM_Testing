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
    { title: "Tier-I AI & ML Engineer Course", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 120 Hours", badge: "Popular", img: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80", price: "₹20,000" },
    { title: "Tier-II Applied ML & CV Engineer Course", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 120 Hours", badge: "Best Seller", img: "https://images.unsplash.com/photo-1527474305487-b87b222841cc?auto=format&fit=crop&w=600&q=80", price: "₹20,000" },
    { title: "Tier-III Advanced Deep Learning & AI scaling", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 240 Hours", badge: "Advanced", img: "https://images.unsplash.com/photo-1677442136019-21780efad99a?auto=format&fit=crop&w=600&q=80", price: "₹40,000" }
  ],
  datascience: [
    { title: "Data Science & Data Analytics Certification", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 120 Hours", badge: "Trending", img: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=600&q=80", price: "₹20,000", detailUrl: "data-science-course.html" },
    { title: "Tier-I AI & ML Engineer Course", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 120 Hours", badge: "Popular", img: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80", price: "₹20,000", detailUrl: "data-science-course.html" }
  ],
  ai: [
    { title: "Tier-II Applied ML & CV Engineer Course", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 120 Hours", badge: "Best Seller", img: "https://images.unsplash.com/photo-1527474305487-b87b222841cc?auto=format&fit=crop&w=600&q=80", price: "₹20,000", detailUrl: "ai-course.html" },
    { title: "Tier-III Advanced Deep Learning & AI scaling", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 240 Hours", badge: "Advanced", img: "https://images.unsplash.com/photo-1677442136019-21780efad99a?auto=format&fit=crop&w=600&q=80", price: "₹40,000", detailUrl: "ai-course.html" }
  ],
  foundation: [
    { title: "Python Programming Basics & Math", faculty: "Dr. Pranav Nerurkar", mode: "Online/Offline | 60 Hours", badge: "New Batch", img: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80", price: "₹10,000" }
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
    
    let priceHTML = '';
    if (course.price) {
      priceHTML = `<span class="course-price" style="font-weight: 700; color: var(--primary); font-size: 1.15rem;">${course.price}</span>`;
    }
    
    // Determine the URL for the detail page
    const detailUrl = course.detailUrl || (course.id ? `course-details.html?id=${course.id}` : '#');
    
    card.innerHTML = `
      <div class="course-img">
        ${badgeHTML}
        <img src="${course.img || 'assets/course.jpg'}" alt="${course.title}">
      </div>
      <div class="course-content">
        <h3 class="course-title" style="min-height: 56px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${course.title}</h3>
        <div class="course-meta" style="margin-bottom: 12px;">
          <span><strong>Faculty:</strong> ${course.faculty || 'Expert Panel'}</span>
          <span><strong>Mode:</strong> ${course.mode || 'Online'}</span>
        </div>
        <div class="course-price-row">
          ${priceHTML}
          <a href="${detailUrl}" class="btn btn-accent" style="padding: 8px 16px; font-size: 0.9rem;">View Details</a>
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

// Mobile menu toggle
const menuToggle = document.getElementById('menuToggle');
const navMenu = document.querySelector('.nav-menu');
const headerActions = document.querySelector('.header-actions');

if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    headerActions.classList.toggle('active');
  });
}
