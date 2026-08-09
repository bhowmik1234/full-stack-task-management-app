import React, { useState, useEffect } from 'react';

interface SliderProps {
  images: string[];
}

const Slider: React.FC<SliderProps> = ({ images }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % images.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + images.length) % images.length);
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
  };

  // Auto-advance, but not while the pointer is resting on the banner.
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(nextSlide, 6000);
    return () => clearInterval(timer);
  }, [paused, images.length]);

  return (
    <section
      className="slider-section"
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {images.map((image, index) => (
        <div
          key={index}
          className={`slide ${index === currentSlide ? 'active' : ''}`}
          aria-hidden={index !== currentSlide}
        >
          <img src={image} alt="" />
        </div>
      ))}
      <button type="button" className="arrow prev" onClick={prevSlide} aria-label="Previous slide">
        &#10094;
      </button>
      <button type="button" className="arrow next" onClick={nextSlide} aria-label="Next slide">
        &#10095;
      </button>
      <div className="dots">
        {images.map((_, index) => (
          <button
            type="button"
            key={index}
            className={`dot ${index === currentSlide ? 'active' : ''}`}
            onClick={() => goToSlide(index)}
            aria-label={`Go to slide ${index + 1}`}
            aria-current={index === currentSlide}
          />
        ))}
      </div>
    </section>
  );
};

export default Slider;
