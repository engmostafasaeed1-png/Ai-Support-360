import Navbar from '@/components/landing/Navbar';
import HeroSection from '@/components/landing/HeroSection';
import ExploreServicesSection from '@/components/landing/ExploreServicesSection';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import WhyQurtubaSection from '@/components/landing/WhyQurtubaSection';
import ValueDifferentiationSection from '@/components/landing/ValueDifferentiationSection';
import ConsultantsSection from '@/components/landing/ConsultantsSection';
import TestimonialsSection from '@/components/landing/TestimonialsSection';
import PricingSection from '@/components/landing/PricingSection';
import FAQSection from '@/components/landing/FAQSection';
import ContactSection from '@/components/landing/ContactSection';
import Footer from '@/components/landing/Footer';
import ScrollFadeIn from '@/components/landing/ScrollFadeIn';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <ScrollFadeIn>
        <ExploreServicesSection />
      </ScrollFadeIn>
      <ScrollFadeIn delay={50}>
        <HowItWorksSection />
      </ScrollFadeIn>
      <ScrollFadeIn delay={50}>
        <WhyQurtubaSection />
      </ScrollFadeIn>
      <ScrollFadeIn delay={50}>
        <ValueDifferentiationSection />
      </ScrollFadeIn>
      <ScrollFadeIn>
        <ConsultantsSection />
      </ScrollFadeIn>
      <ScrollFadeIn delay={50}>
        <TestimonialsSection />
      </ScrollFadeIn>
      <ScrollFadeIn>
        <PricingSection />
      </ScrollFadeIn>
      <ScrollFadeIn delay={50}>
        <FAQSection />
      </ScrollFadeIn>
      <ScrollFadeIn>
        <ContactSection />
      </ScrollFadeIn>
      <Footer />
    </div>
  );
};

export default Index;
