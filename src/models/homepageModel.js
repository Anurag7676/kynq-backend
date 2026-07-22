// models/homepageModel.js
import mongoose from "mongoose";

const homepageSchema = new mongoose.Schema(
  {
    // Meta Information
    isActive: {
      type: Boolean,
      default: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    // 1. HERO BANNER SECTION
    heroBanner: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      slides: [
        {
          id: String,
          image: {
            url: String,
            alt: String,
          },
          title: {
            type: String,
            required: true,
          },
          subtitle: String,
          description: {
            type: String,
            required: true,
          },
          cta: String,
          buttons: [
            {
              text: String,
              link: String,
              type: {
                type: String,
                enum: ["primary", "secondary"],
                default: "primary",
              },
            },
          ],
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        autoplay: {
          type: Boolean,
          default: true,
        },
        autoplayInterval: {
          type: Number,
          default: 6000,
        },
        showNavigation: {
          type: Boolean,
          default: true,
        },
        showDots: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 2. PARALLAX TEXT SECTION
    parallaxTextSection: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        mainText: {
          type: String,
          default:
            "Where exceptional design meets uncompromising quality, creating spaces that inspire and endure.",
        },
        subText: String,
      },
    },

    // 3. CATEGORY SHOWCASE SECTION
    categoryShowcase: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Curated Categories",
        },
        headingAccent: {
          type: String,
          default: "Categories",
        },
        description: {
          type: String,
          default:
            "Discover our meticulously selected collections, each thoughtfully designed to transform your living spaces.",
        },
        footerText: {
          type: String,
          default: "Swipe to explore all categories or view all categories",
        },
        viewAllText: {
          type: String,
          default: "view all categories",
        },
        viewAllLink: {
          type: String,
          default: "/shop",
        },
      },
      categories: [
        {
          categoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        showAutoScroll: {
          type: Boolean,
          default: true,
        },
        displayLimit: {
          type: Number,
          default: 12,
        },
        fetchAllCategories: {
          type: Boolean,
          default: false, // If true, ignores categories array and fetches all active categories
        },
      },
    },

    // 4. ADVANCED PRODUCT SHOWCASE SECTION
    advancedProductShowcase: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Signature Collection",
        },
        headingAccent: {
          type: String,
          default: "Collection",
        },
        description: {
          type: String,
          default:
            "Explore our most coveted pieces, each one a masterpiece of design and craftsmanship.",
        },
        subDescription: {
          type: String,
          default:
            "Every item in our signature collection represents the perfect harmony of form and function, meticulously crafted to elevate your space with timeless elegance.",
        },
      },
      products: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProducts: {
          type: Number,
          default: 3,
        },
        showColorSelection: {
          type: Boolean,
          default: true,
        },
        showExpandableDetails: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 5. FALLBACK PRODUCT VIEW SECTION
    fallbackProductView: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Product Showcase",
        },
        headingAccent: {
          type: String,
          default: "Showcase",
        },
        description: {
          type: String,
          default: "Experience our furniture in stunning detail.",
        },
        subDescription: {
          type: String,
          default:
            "Explore our signature pieces to appreciate the exceptional craftsmanship and attention to detail.",
        },
      },
      products: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProducts: {
          type: Number,
          default: 2,
        },
        show3DRotation: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 6. LUXURY SHOWCASE SECTION
    luxuryShowcase: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Luxury Elements",
        },
        headingAccent: {
          type: String,
          default: "Elements",
        },
        description: {
          type: String,
          default:
            "Discover the exceptional pieces that define our signature aesthetic.",
        },
        subDescription: {
          type: String,
          default:
            "Each element in our collection represents the perfect balance of form and function, meticulously crafted to elevate your space with timeless elegance.",
        },
      },
      products: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          customTitle: String, // Override product name if needed
          customDescription: String, // Override product description if needed
          customDetails: String, // Additional details for luxury showcase
          customFeatures: [String], // Custom features list
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProducts: {
          type: Number,
          default: 3,
        },
        alternateLayout: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 7. FEATURED PRODUCTS SECTION
    featuredProducts: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Featured Collection",
        },
        headingAccent: {
          type: String,
          default: "Collection",
        },
        description: {
          type: String,
          default:
            "Discover our handpicked selection of premium interior design elements that blend artistry with functionality.",
        },
        viewAllText: {
          type: String,
          default: "View All Products",
        },
        viewAllLink: {
          type: String,
          default: "/collections/featured",
        },
      },
      products: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProducts: {
          type: Number,
          default: 5,
        },
        showMobileCarousel: {
          type: Boolean,
          default: true,
        },
        showProductActions: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 8. IMMERSIVE GALLERY SECTION
    immersiveGallery: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Immersive Gallery",
        },
        headingAccent: {
          type: String,
          default: "Gallery",
        },
        description: {
          type: String,
          default:
            "Explore our portfolio of exceptional designs and architectural masterpieces.",
        },
        subDescription: {
          type: String,
          default:
            "Each project represents our commitment to excellence, innovation, and the seamless integration of aesthetics and functionality.",
        },
      },
      projects: [
        {
          title: {
            type: String,
            required: true,
          },
          description: {
            type: String,
            required: true,
          },
          image: {
            url: String,
            alt: String,
          },
          category: {
            type: String,
            required: true,
          },
          location: {
            type: String,
            required: true,
          },
          completionYear: {
            type: String,
            default: "2023",
          },
          designer: {
            type: String,
            default: "STYLE N HOMES Studio",
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProjects: {
          type: Number,
          default: 6,
        },
        showModal: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 9. PARALLAX GALLERY SECTION
    parallaxGallery: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Design Excellence",
        },
        headingAccent: {
          type: String,
          default: "Excellence",
        },
        description: {
          type: String,
          default:
            "Explore our portfolio of architectural marvels and interior masterpieces that redefine luxury living.",
        },
        subDescription: {
          type: String,
          default:
            "From concept to completion, we create spaces that harmonize form and function, reflecting the unique personality and lifestyle of each client while pushing the boundaries of design innovation.",
        },
        ctaText: {
          type: String,
          default: "Explore Our Portfolio",
        },
        ctaLink: {
          type: String,
          default: "/projects",
        },
      },
      galleries: [
        {
          title: {
            type: String,
            required: true,
          },
          description: {
            type: String,
            required: true,
          },
          image: {
            url: String,
            alt: String,
          },
          linkText: {
            type: String,
            default: "Discover More",
          },
          linkUrl: String,
          position: {
            type: String,
            enum: ["left", "center", "right"],
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
    },

    // 10. PRODUCT SPOTLIGHT SECTION
    productSpotlight: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Product Spotlight",
        },
        headingAccent: {
          type: String,
          default: "Spotlight",
        },
        description: {
          type: String,
          default:
            "Explore our featured products in detail, each one selected for its exceptional design and quality.",
        },
        subDescription: {
          type: String,
          default:
            "Our product spotlight showcases the pinnacle of interior design excellence, where innovative materials, masterful craftsmanship, and timeless aesthetics converge to create pieces that transcend trends and elevate your space.",
        },
      },
      products: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          customDetails: [String], // Custom detail points for spotlight
          specifications: {
            dimensions: String,
            materials: String,
            warranty: String,
            shipping: String,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProducts: {
          type: Number,
          default: 3,
        },
        showChat: {
          type: Boolean,
          default: true,
        },
        showHotspots: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 11. DESIGN PHILOSOPHY SECTION
    designPhilosophy: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Our Design Philosophy",
        },
        headingAccent: {
          type: String,
          default: "Philosophy",
        },
        mainText: {
          type: String,
          default:
            "At STYLE N HOMES, we believe that exceptional interior design is about creating spaces that reflect your unique personality while maintaining a perfect balance between aesthetics and functionality.",
        },
        secondaryText: {
          type: String,
          default:
            "Our approach combines timeless elegance with contemporary innovation, resulting in interiors that are both sophisticated and livable. We meticulously select each piece for its quality, craftsmanship, and ability to transform a space.",
        },
        philosophyCards: [
          {
            title: {
              type: String,
              default: "Timeless Elegance",
            },
            description: {
              type: String,
              default:
                "Designs that transcend trends and remain beautiful for years to come.",
            },
            ctaButton: {
              text: String,
              link: String,
            },
          },
          {
            title: {
              type: String,
              default: "Artisanal Quality",
            },
            description: {
              type: String,
              default:
                "Handcrafted pieces that showcase exceptional skill and attention to detail.",
            },
            ctaButton: {
              text: String,
              link: String,
            },
          },
        ],
      },
      images: {
        mainImage: {
          url: String,
          alt: String,
        },
        accentImage: {
          url: String,
          alt: String,
        },
      },
    },

    // 12. PROJECTS SHOWCASE SECTION
    projectsShowcase: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Featured Projects",
        },
        headingAccent: {
          type: String,
          default: "Projects",
        },
        description: {
          type: String,
          default:
            "Explore our portfolio of meticulously crafted interior design projects that showcase our expertise and vision.",
        },
        viewAllText: {
          type: String,
          default: "View All Projects",
        },
      },
      projects: [
        {
          title: {
            type: String,
            required: true,
          },
          description: {
            type: String,
            required: true,
          },
          image: {
            url: String,
            alt: String,
          },
          images: [
            {
              url: String,
              alt: String,
            },
          ],
          category: {
            type: String,
            required: true,
          },
          location: {
            type: String,
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxProjects: {
          type: Number,
          default: 4,
        },
        showModal: {
          type: Boolean,
          default: true,
        },
      },
    },

    // 13. COMPANY STORY SECTION
    companyStory: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Our Journey",
        },
        headingAccent: {
          type: String,
          default: "Journey",
        },
        description: {
          type: String,
          default:
            "Crafting exceptional spaces and experiences for over two decades.",
        },
        subDescription: {
          type: String,
          default:
            "Our story is one of passion, innovation, and unwavering commitment to excellence in every detail.",
        },
        quote: {
          text: {
            type: String,
            default:
              "Our mission is to create spaces that transcend trends and stand as testaments to timeless design excellence.",
          },
          author: {
            type: String,
            default: "Founder & Creative Director",
          },
        },
      },
      timeline: [
        {
          year: {
            type: String,
            required: true,
          },
          title: {
            type: String,
            required: true,
          },
          description: {
            type: String,
            required: true,
          },
          image: {
            url: String,
            alt: String,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
    },

    // 14. FEATURED BLOGS SECTION
    featuredBlogs: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Our Journal",
        },
        description: {
          type: String,
          default:
            "Explore our latest articles on interior design trends, styling tips, and home transformation stories",
        },
        viewAllText: {
          type: String,
          default: "View All Articles",
        },
        viewAllLink: {
          type: String,
          default: "/blog",
        },
      },
      blogs: [
        {
          blogId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Blog",
            required: true,
          },
          displayOrder: {
            type: Number,
            default: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      settings: {
        maxBlogs: {
          type: Number,
          default: 3,
        },
        fetchFromAPI: {
          type: Boolean,
          default: false, // If true, ignores blogs array and fetches featured blogs from API
        },
        apiEndpoint: {
          type: String,
          default: "/api/blogs/featured",
        },
        showFeaturedOnly: {
          type: Boolean,
          default: false, // If true and fetchFromAPI is false, only shows blogs marked as featured
        },
      },
    },

    // 15. CONTACT SECTION
    contactSection: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      content: {
        heading: {
          type: String,
          default: "Get In Touch",
        },
        headingAccent: {
          type: String,
          default: "Touch",
        },
        description: {
          type: String,
          default:
            "Have questions or ready to transform your space? Reach out to our team of design experts.",
        },
        formLabels: {
          name: {
            type: String,
            default: "Name",
          },
          email: {
            type: String,
            default: "Email",
          },
          subject: {
            type: String,
            default: "Subject",
          },
          message: {
            type: String,
            default: "Message",
          },
          submitButton: {
            type: String,
            default: "Send Message",
          },
        },
        contactInfo: {
          address: {
            title: {
              type: String,
              default: "Visit Our Studio",
            },
            address: {
              type: String,
              default: "27 Design District, New York, NY 10001",
            },
          },
          phone: {
            title: {
              type: String,
              default: "Call Us",
            },
            number: {
              type: String,
              default: "+1 (202) 555-0189",
            },
          },
          email: {
            title: {
              type: String,
              default: "Email Us",
            },
            address: {
              type: String,
              default: "info@stylesandhomes.com",
            },
          },
        },
        workingHours: {
          title: {
            type: String,
            default: "Working Hours",
          },
          schedule: [
            {
              days: {
                type: String,
                default: "Monday - Friday",
              },
              hours: {
                type: String,
                default: "9:00 AM - 6:00 PM",
              },
            },
            {
              days: {
                type: String,
                default: "Saturday",
              },
              hours: {
                type: String,
                default: "10:00 AM - 4:00 PM",
              },
            },
            {
              days: {
                type: String,
                default: "Sunday",
              },
              hours: {
                type: String,
                default: "Closed",
              },
            },
          ],
        },
        socialMedia: {
          title: {
            type: String,
            default: "Follow Us",
          },
          links: [
            {
              platform: String,
              url: String,
              isActive: {
                type: Boolean,
                default: true,
              },
            },
          ],
        },
      },
    },

    // GLOBAL SETTINGS
    globalSettings: {
      sectionSpacing: {
        type: String,
        enum: ["compact", "normal", "spacious"],
        default: "normal",
      },
      animationSpeed: {
        type: String,
        enum: ["slow", "normal", "fast"],
        default: "normal",
      },
      colorScheme: {
        type: String,
        enum: ["default", "light", "dark"],
        default: "default",
      },
    },

    // SEO SETTINGS
    seo: {
      title: {
        type: String,
        default: "STYLE N HOMES - Luxury Interior Design",
      },
      description: {
        type: String,
        default:
          "Transform your space with our handpicked collection of premium interior design elements. Discover timeless elegance and exceptional craftsmanship.",
      },
      keywords: [String],
      ogImage: {
        url: String,
        alt: String,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
homepageSchema.index({ isActive: 1 });
homepageSchema.index({ lastUpdated: -1 });

// Virtual to populate product references
homepageSchema.virtual("populatedAdvancedProducts", {
  ref: "Product",
  localField: "advancedProductShowcase.products.productId",
  foreignField: "_id",
});

homepageSchema.virtual("populatedFallbackProducts", {
  ref: "Product",
  localField: "fallbackProductView.products.productId",
  foreignField: "_id",
});

homepageSchema.virtual("populatedLuxuryProducts", {
  ref: "Product",
  localField: "luxuryShowcase.products.productId",
  foreignField: "_id",
});

homepageSchema.virtual("populatedFeaturedProducts", {
  ref: "Product",
  localField: "featuredProducts.products.productId",
  foreignField: "_id",
});

homepageSchema.virtual("populatedSpotlightProducts", {
  ref: "Product",
  localField: "productSpotlight.products.productId",
  foreignField: "_id",
});

// Virtual to populate category references
homepageSchema.virtual("populatedCategories", {
  ref: "Category",
  localField: "categoryShowcase.categories.categoryId",
  foreignField: "_id",
});

// Virtual to populate blog references
homepageSchema.virtual("populatedBlogs", {
  ref: "Blog",
  localField: "featuredBlogs.blogs.blogId",
  foreignField: "_id",
});

// Enable virtual fields in JSON output
homepageSchema.set("toJSON", { virtuals: true });
homepageSchema.set("toObject", { virtuals: true });

// Pre-save hook to update lastUpdated
homepageSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

const Homepage = mongoose.model("Homepage", homepageSchema);

export default Homepage;
