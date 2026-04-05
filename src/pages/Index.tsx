import Navbar from '@/components/landing/Navbar';
import HeroSection from '@/components/landing/HeroSection';
import ExploreServicesSection from '@/components/landing/ExploreServicesSection';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import WhyQurtubaSection from '@/components/landing/WhyQurtubaSection';
import ConsultantsSection from '@/components/landing/ConsultantsSection';
import TestimonialsSection from '@/components/landing/TestimonialsSection';
import PricingSection from '@/components/landing/PricingSection';
import FAQSection from '@/components/landing/FAQSection';
import ContactSection from '@/components/landing/ContactSection';
import Footer from '@/components/landing/Footer';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <CategoriesSection />
      <HowItWorksSection />
      <WhyQurtubaSection />
      <IndustriesSection />
      <ConsultantsSection />
      <TestimonialsSection />
      <PricingSection />
      <FAQSection />
      <ContactSection />
      <Footer />
    </div>
  );
};

export default Index;
