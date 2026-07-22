



import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import User from "../models/userModel.js";

// Helper function to check user permissions
const hasPermission = (req, section) => {
  // Admins have access to everything
  if (req.userType === 'admin') {
    return true;
  }
  
  // Editors need specific section permission
  if (req.userType === 'editor') {
    return req.editor.permissions[section] === true;
  }
  
  return false;
};

// ULTRA SAFE - Minimal memory usage with permission filtering
const getDashboardAnalytics = async (req, res) => {
  try {
    console.log('📊 Lightweight dashboard request with permissions');

    const {
      period = '30days',
      startDate: customStart,
      endDate: customEnd,
    } = req.query;

    // Simple date calculation
    const today = new Date();
    const startDate = customStart ? new Date(customStart) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDate = customEnd ? new Date(customEnd) : today;

    // Initialize response object
    const dashboardData = {
      filterInfo: {
        period,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        groupBy: 'day',
        isCustomRange: !!(customStart && customEnd)
      },
      overview: {},
      revenueGraph: { data: [], summary: { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 } },
      recentOrders: [],
      productAnalytics: {
        topSellingProducts: [],
        lowStockProducts: [],
        stockSummary: { totalProducts: 0, publishedProducts: 0, outOfStockProducts: 0, lowStockCount: 0 }
      },
      customerAnalytics: {
        totalCustomers: 0,
        activeCustomers: 0,
        newCustomersToday: 0,
        newCustomersThisMonth: 0,
        newCustomersPeriod: 0,
        customerGrowth: 0
      }
    };

    // Check permissions and fetch data accordingly
    
    // FINANCIAL DATA (requires financial permission)
    if (hasPermission(req, 'financial')) {
      try {
        const [totalRevenue, periodRevenue] = await Promise.all([
          Order.aggregate([
            { $match: { isPaid: true } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
            { $limit: 1 }
          ]),
          Order.aggregate([
            { $match: { isPaid: true, paidAt: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
            { $limit: 1 }
          ])
        ]);

        dashboardData.overview.totalRevenue = totalRevenue[0]?.total || 0;
        dashboardData.overview.periodRevenue = periodRevenue[0]?.total || 0;

        // Revenue graph data
        const revenueData = await Order.aggregate([
          { $match: { isPaid: true, paidAt: { $gte: startDate, $lte: endDate } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt" } },
              revenue: { $sum: "$totalPrice" },
              orders: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 100 }
        ]);

        // Generate graph data
        const graphData = [];
        const current = new Date(startDate);
        let iterations = 0;
        
        while (current <= endDate && iterations < 50) {
          const dateKey = current.toISOString().split('T')[0];
          const existing = revenueData.find(item => item._id === dateKey);
          
          graphData.push({
            date: dateKey,
            displayDate: current.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric' 
            }),
            revenue: existing ? existing.revenue : 0,
            orders: existing ? existing.orders : 0
          });
          
          current.setDate(current.getDate() + 1);
          iterations++;
        }

        dashboardData.revenueGraph = {
          data: graphData,
          summary: {
            totalRevenue: graphData.reduce((sum, item) => sum + item.revenue, 0),
            totalOrders: graphData.reduce((sum, item) => sum + item.orders, 0),
            avgOrderValue: graphData.length > 0 
              ? (graphData.reduce((sum, item) => sum + item.revenue, 0) / 
                 Math.max(graphData.reduce((sum, item) => sum + item.orders, 0), 1)).toFixed(2)
              : 0
          }
        };
      } catch (error) {
        console.error('Financial data error:', error);
      }
    } else {
      // No financial permission - show zero values
      dashboardData.overview.totalRevenue = 0;
      dashboardData.overview.periodRevenue = 0;
    }

    // ECOMMERCE DATA (requires ecommerce permission)
    if (hasPermission(req, 'ecommerce')) {
      try {
        const [totalOrders, periodOrders, totalProducts, publishedProducts] = await Promise.all([
          Order.countDocuments(),
          Order.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
          Product.countDocuments(),
          Product.countDocuments({ isPublished: true })
        ]);

        dashboardData.overview.totalOrders = totalOrders;
        dashboardData.overview.periodOrders = periodOrders;
        dashboardData.overview.totalProducts = totalProducts;
        dashboardData.overview.publishedProducts = publishedProducts;

        // Recent orders
        const recentOrders = await Order.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .select("invoiceNumber totalPrice orderStatus createdAt")
          .lean();

        dashboardData.recentOrders = recentOrders.map(order => ({
          id: order._id,
          invoiceNumber: order.invoiceNumber || 'N/A',
          totalPrice: order.totalPrice || 0,
          orderStatus: order.orderStatus || 'unknown',
          createdAt: order.createdAt
        }));

        // Product analytics
        dashboardData.productAnalytics.stockSummary = {
          totalProducts,
          publishedProducts,
          outOfStockProducts: 0, // Could add this query if needed
          lowStockCount: 0
        };
      } catch (error) {
        console.error('Ecommerce data error:', error);
      }
    } else {
      // No ecommerce permission - show zero values
      dashboardData.overview.totalOrders = 0;
      dashboardData.overview.periodOrders = 0;
      dashboardData.overview.totalProducts = 0;
      dashboardData.overview.publishedProducts = 0;
    }

    // CUSTOMER DATA (requires customers permission)
    if (hasPermission(req, 'customers')) {
      try {
        const totalCustomers = await User.countDocuments({ role: "user" });
        dashboardData.overview.totalCustomers = totalCustomers;
        dashboardData.customerAnalytics.totalCustomers = totalCustomers;
      } catch (error) {
        console.error('Customer data error:', error);
      }
    } else {
      // No customers permission - show zero values
      dashboardData.overview.totalCustomers = 0;
    }

    // Add default values for fields not covered by permissions
    dashboardData.overview = {
      ...dashboardData.overview,
      todayRevenue: 0,
      thisMonthRevenue: 0,
      totalTaxCollected: 0,
      todayTaxCollected: 0,
      thisMonthTaxCollected: 0,
      todayOrders: 0,
      pendingOrders: 0,
      completedOrders: 0,
      outOfStockProducts: 0,
      activeCustomers: 0,
      newCustomersPeriod: 0,
      unreportedTaxOrders: 0,
      revenueGrowth: 0,
      ordersGrowth: 0
    };

    console.log('✅ Lightweight dashboard completed with permissions');

    res.status(200).json({
      success: true,
      data: dashboardData,
      permissions: {
        financial: hasPermission(req, 'financial'),
        ecommerce: hasPermission(req, 'ecommerce'),
        customers: hasPermission(req, 'customers'),
        cms: hasPermission(req, 'cms')
      }
    });

  } catch (error) {
    console.error("❌ Dashboard error:", error.message);
    
    // SAFE fallback
    res.status(200).json({
      success: true,
      data: {
        filterInfo: {
          period: '30days',
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0],
          groupBy: 'day',
          isCustomRange: false
        },
        overview: {
          totalRevenue: 0,
          periodRevenue: 0,
          totalOrders: 0,
          periodOrders: 0,
          totalProducts: 0,
          publishedProducts: 0,
          totalCustomers: 0,
          todayRevenue: 0,
          thisMonthRevenue: 0,
          totalTaxCollected: 0,
          todayTaxCollected: 0,
          thisMonthTaxCollected: 0,
          todayOrders: 0,
          pendingOrders: 0,
          completedOrders: 0,
          outOfStockProducts: 0,
          activeCustomers: 0,
          newCustomersPeriod: 0,
          unreportedTaxOrders: 0,
          revenueGrowth: 0,
          ordersGrowth: 0
        },
        revenueGraph: { data: [], summary: { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 } },
        recentOrders: [],
        productAnalytics: {
          topSellingProducts: [],
          lowStockProducts: [],
          stockSummary: { totalProducts: 0, publishedProducts: 0, outOfStockProducts: 0, lowStockCount: 0 }
        },
        customerAnalytics: {
          totalCustomers: 0,
          activeCustomers: 0,
          newCustomersToday: 0,
          newCustomersThisMonth: 0,
          newCustomersPeriod: 0,
          customerGrowth: 0
        }
      },
      permissions: {
        financial: false,
        ecommerce: false,
        customers: false,
        cms: false
      }
    });
  }
};

// ULTRA SAFE widgets with permission filtering
const getDashboardWidgets = async (req, res) => {
  try {
    const widgets = {};

    // Financial data (requires financial permission)
    if (hasPermission(req, 'financial')) {
      const totalRevenue = await Order.aggregate([
        { $match: { isPaid: true } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        { $limit: 1 }
      ]);
      widgets.totalRevenue = totalRevenue[0]?.total || 0;
      widgets.totalTaxCollected = 0; // Could add this query if needed
      widgets.todayOrders = 0;
      widgets.unreportedTaxOrders = 0;
    } else {
      widgets.totalRevenue = 0;
      widgets.totalTaxCollected = 0;
      widgets.todayOrders = 0;
      widgets.unreportedTaxOrders = 0;
    }

    // Ecommerce data (requires ecommerce permission)  
    if (hasPermission(req, 'ecommerce')) {
      const [totalOrders, totalProducts] = await Promise.all([
        Order.countDocuments(),
        Product.countDocuments({ isPublished: true })
      ]);
      widgets.totalOrders = totalOrders;
      widgets.totalProducts = totalProducts;
      widgets.pendingOrders = 0; // Could add this query if needed
    } else {
      widgets.totalOrders = 0;
      widgets.totalProducts = 0;
      widgets.pendingOrders = 0;
    }

    // Customer data (requires customers permission)
    if (hasPermission(req, 'customers')) {
      const totalCustomers = await User.countDocuments({ role: "user" });
      widgets.totalCustomers = totalCustomers;
    } else {
      widgets.totalCustomers = 0;
    }

    res.status(200).json({
      success: true,
      widgets,
      permissions: {
        financial: hasPermission(req, 'financial'),
        ecommerce: hasPermission(req, 'ecommerce'),
        customers: hasPermission(req, 'customers')
      }
    });

  } catch (error) {
    console.error("❌ Widgets error:", error.message);
    res.status(200).json({
      success: true,
      widgets: {
        totalRevenue: 0,
        totalOrders: 0,
        totalProducts: 0,
        totalCustomers: 0,
        totalTaxCollected: 0,
        todayOrders: 0,
        pendingOrders: 0,
        unreportedTaxOrders: 0
      },
      permissions: {
        financial: false,
        ecommerce: false,
        customers: false
      }
    });
  }
};

// SAFE revenue chart with permission check
const getRevenueChartData = async (req, res) => {
  try {
    // Check if user has financial permission for revenue data
    if (!hasPermission(req, 'financial')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Financial permission required to view revenue data.'
      });
    }

    const { period = '30days', startDate: customStart, endDate: customEnd } = req.query;

    const today = new Date();
    const startDate = customStart ? new Date(customStart) : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDate = customEnd ? new Date(customEnd) : today;

    // Simple revenue data
    const revenueData = await Order.aggregate([
      { $match: { isPaid: true, paidAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt" } },
          revenue: { $sum: "$totalPrice" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 100 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        chartData: revenueData.map(item => ({
          date: item._id,
          displayDate: new Date(item._id).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
          }),
          revenue: item.revenue,
          orders: item.orders
        })),
        filterInfo: {
          period,
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          groupBy: 'day',
          isCustomRange: !!(customStart && customEnd)
        },
        summary: {
          totalRevenue: revenueData.reduce((sum, item) => sum + item.revenue, 0),
          totalOrders: revenueData.reduce((sum, item) => sum + item.orders, 0)
        }
      }
    });

  } catch (error) {
    console.error("❌ Revenue chart error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch revenue chart data"
    });
  }
};

// Stock alerts with permission check
const getStockAlerts = async (req, res) => {
  try {
    // Check if user has ecommerce permission for stock data
    if (!hasPermission(req, 'ecommerce')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Ecommerce permission required to view stock data.'
      });
    }

    // ... rest of the existing getStockAlerts code remains the same ...
    console.log('📦 Stock alerts request');

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    
    const {
      stockStatus = 'all',
      category,
      sortBy = 'stock'
    } = req.query;

    let filter = { 
      isPublished: true,
      isRequestQuote: false // Only regular products for stock alerts
    };

    if (stockStatus === 'low') {
      filter.stock = { $lte: 10, $gt: 0 };
    } else if (stockStatus === 'out') {
      filter.stock = 0;
    } else if (stockStatus === 'all') {
      filter.stock = { $lte: 10 };
    }

    if (category) {
      filter.category = category;
    }

    let sort = {};
    switch (sortBy) {
      case 'stock': sort.stock = 1; break;
      case 'name': sort.name = 1; break;
      case 'createdAt': sort.createdAt = -1; break;
      default: sort.stock = 1;
    }

    const [products, totalCount] = await Promise.all([
      Product.find(filter)
        .select('name sku stock price category createdAt updatedAt isRequestQuote')
        .populate('category', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const [stockSummary] = await Promise.all([
      Product.aggregate([
        { 
          $match: { 
            isPublished: true,
            isRequestQuote: false // Only regular products for stock analysis
          } 
        },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            lowStockCount: {
              $sum: {
                $cond: [
                  { $and: [{ $lte: ["$stock", 10] }, { $gt: ["$stock", 0] }] },
                  1,
                  0
                ]
              }
            },
            outOfStockCount: {
              $sum: {
                $cond: [{ $eq: ["$stock", 0] }, 1, 0]
              }
            },
            totalStockValue: {
              $sum: { $multiply: ["$stock", "$price"] }
            }
          }
        }
      ])
    ]);

    const categoryBreakdown = await Product.aggregate([
      {
        $match: {
          isPublished: true,
          isRequestQuote: false, // Only regular products
          stock: { $lte: 10 }
        }
      },
      {
        $group: {
          _id: "$category",
          lowStockCount: {
            $sum: {
              $cond: [
                { $and: [{ $lte: ["$stock", 10] }, { $gt: ["$stock", 0] }] },
                1,
                0
              ]
            }
          },
          outOfStockCount: {
            $sum: {
              $cond: [{ $eq: ["$stock", 0] }, 1, 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "categoryInfo"
        }
      },
      {
        $unwind: "$categoryInfo"
      },
      {
        $project: {
          _id: 1,
          name: "$categoryInfo.name",
          lowStockCount: 1,
          outOfStockCount: 1,
          totalAlerts: { $add: ["$lowStockCount", "$outOfStockCount"] }
        }
      },
      { $sort: { totalAlerts: -1 } },
      { $limit: 10 }
    ]);

    const formattedProducts = products.map(product => ({
      id: product._id,
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      price: product.price,
      category: product.category?.name || 'Uncategorized',
      categoryId: product.category?._id,
      stockStatus: product.stock === 0 ? 'out_of_stock' : 
                   product.stock <= 10 ? 'low_stock' : 'in_stock',
      stockLevel: product.stock === 0 ? 'critical' :
                  product.stock <= 5 ? 'very_low' :
                  product.stock <= 10 ? 'low' : 'normal',
      lastUpdated: product.updatedAt,
      createdAt: product.createdAt
    }));

    const summary = stockSummary[0] || {
      totalProducts: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      totalStockValue: 0
    };

    console.log('✅ Stock alerts completed');

    res.status(200).json({
      success: true,
      data: {
        products: formattedProducts,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          count: products.length,
          limit,
          hasNextPage,
          hasPrevPage,
          nextPage: hasNextPage ? page + 1 : null,
          prevPage: hasPrevPage ? page - 1 : null
        },
        summary: {
          totalProducts: summary.totalProducts,
          lowStockCount: summary.lowStockCount,
          outOfStockCount: summary.outOfStockCount,
          totalAlerts: summary.lowStockCount + summary.outOfStockCount,
          totalStockValue: summary.totalStockValue || 0,
          alertPercentage: summary.totalProducts > 0 
            ? ((summary.lowStockCount + summary.outOfStockCount) / summary.totalProducts * 100).toFixed(1)
            : 0
        },
        categoryBreakdown,
        filters: {
          applied: {
            stockStatus,
            category: category || null,
            sortBy
          },
          available: {
            stockStatuses: [
              { value: 'all', label: 'All Alerts' },
              { value: 'low', label: 'Low Stock Only' },
              { value: 'out', label: 'Out of Stock Only' }
            ],
            sortOptions: [
              { value: 'stock', label: 'Stock Level' },
              { value: 'name', label: 'Product Name' },
              { value: 'createdAt', label: 'Date Added' }
            ]
          }
        }
      }
    });

  } catch (error) {
    console.error("❌ Stock alerts error:", error.message);
    
    res.status(500).json({
      success: false,
      message: "Failed to fetch stock alerts",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Stock summary with permission check
const getStockSummary = async (req, res) => {
  try {
    // Check if user has ecommerce permission for stock data
    if (!hasPermission(req, 'ecommerce')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Ecommerce permission required to view stock data.'
      });
    }

    console.log('📊 Stock summary request');

    // Get comprehensive stock summary with proper filtering
    const stockSummary = await Product.aggregate([
      { 
        $match: { 
          isPublished: true,
          isRequestQuote: false // Only regular products for stock analysis
        } 
      },
      {
        $group: {
          _id: null,
          regularProductsCount: { $sum: 1 }, // Count of regular products only
          lowStockCount: {
            $sum: {
              $cond: [
                { $and: [{ $lte: ["$stock", 10] }, { $gt: ["$stock", 0] }] },
                1,
                0
              ]
            }
          },
          outOfStockCount: {
            $sum: {
              $cond: [{ $eq: ["$stock", 0] }, 1, 0]
            }
          },
          criticalStockCount: {
            $sum: {
              $cond: [
                { $and: [{ $lte: ["$stock", 5] }, { $gt: ["$stock", 0] }] },
                1,
                0
              ]
            }
          },
          veryLowStockCount: {
            $sum: {
              $cond: [
                { $and: [{ $lte: ["$stock", 3] }, { $gt: ["$stock", 0] }] },
                1,
                0
              ]
            }
          },
          totalStockValue: {
            $sum: { $multiply: ["$stock", "$price"] }
          },
          totalStockQuantity: {
            $sum: "$stock"
          }
        }
      }
    ]);

    // Get total published products (including quote products)
    const totalPublishedProducts = await Product.countDocuments({ isPublished: true });
    
    // Get quote products count
    const quoteProductsCount = await Product.countDocuments({
      isPublished: true,
      isRequestQuote: true
    });

    const summary = stockSummary[0] || {
      regularProductsCount: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      criticalStockCount: 0,
      veryLowStockCount: 0,
      totalStockValue: 0,
      totalStockQuantity: 0
    };

    // Calculate healthy stock count (products with stock > 10)
    const healthyStockCount = summary.regularProductsCount - summary.lowStockCount - summary.outOfStockCount;

    // Calculate alert percentage (only for regular products)
    const alertPercentage = summary.regularProductsCount > 0 
      ? ((summary.lowStockCount + summary.outOfStockCount) / summary.regularProductsCount * 100).toFixed(1)
      : 0;

    console.log('✅ Stock summary completed');

    res.status(200).json({
      success: true,
      summary: {
        totalProducts: totalPublishedProducts, // Total ALL published products (including quote products)
        lowStockCount: summary.lowStockCount,
        outOfStockCount: summary.outOfStockCount,
        criticalStockCount: summary.criticalStockCount,
        totalAlerts: summary.lowStockCount + summary.outOfStockCount,
        healthyStockCount: healthyStockCount,
        alertPercentage: alertPercentage
      }
    });

  } catch (error) {
    console.error("❌ Stock summary error:", error.message);
    
    res.status(500).json({
      success: false,
      message: "Failed to fetch stock summary",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Simple filter options (no permission check needed)
const getFilterOptions = async (req, res) => {
  try {
    const today = new Date();
    
    res.status(200).json({
      success: true,
      data: {
        predefinedPeriods: [
          { value: 'today', label: 'Today' },
          { value: '7days', label: 'Last 7 Days' },
          { value: '30days', label: 'Last 30 Days' },
          { value: '90days', label: 'Last 90 Days' }
        ],
        groupByOptions: [
          { value: 'day', label: 'Daily' }
        ],
        dateRange: {
          earliest: "2024-01-01",
          latest: today.toISOString().split('T')[0],
          default: {
            start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
          }
        }
      }
    });

  } catch (error) {
    console.error("❌ Filter options error:", error.message);
    res.status(200).json({
      success: true,
      data: {
        predefinedPeriods: [
          { value: '30days', label: 'Last 30 Days' }
        ],
        groupByOptions: [
          { value: 'day', label: 'Daily' }
        ],
        dateRange: {
          earliest: "2024-01-01",
          latest: new Date().toISOString().split('T')[0],
          default: {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            end: new Date().toISOString().split('T')[0]
          }
        }
      }
    });
  }
};

export {
  getDashboardAnalytics,
  getDashboardWidgets,
  getRevenueChartData,
  getFilterOptions,
  getStockAlerts,
  getStockSummary
};