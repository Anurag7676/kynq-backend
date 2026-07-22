import Wishlist from "../models/wishlistModel.js";
import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";

const getWishlist = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    let wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    if (!wishlist) {
      wishlist = new Wishlist({
        user: req.user._id,
        items: [],
        name: "My Wishlist",
      });
      await wishlist.save();
    }

    res.status(200).json({
      success: true,
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const addToWishlist = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { productId, roomType, notes } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    let wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      wishlist = new Wishlist({
        user: req.user._id,
        items: [],
        name: "My Wishlist",
      });
    }

    wishlist.addItem(productId, roomType, notes);
    await wishlist.save();

    await wishlist.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Item added to wishlist",
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateWishlistItem = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { itemId, roomType, notes } = req.body;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required",
      });
    }

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    wishlist.updateItem(itemId, roomType, notes);
    await wishlist.save();

    await wishlist.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Wishlist item updated",
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const removeFromWishlist = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { itemId } = req.params;

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    wishlist.removeItem(itemId);
    await wishlist.save();

    await wishlist.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Item removed from wishlist",
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const moveToCart = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { itemId } = req.params;

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    const result = await wishlist.moveItemToCart(itemId, Cart);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    await wishlist.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: result.message,
      wishlist,
      cart: result.cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const clearWishlist = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    wishlist.clearWishlist();
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: "Wishlist cleared",
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateWishlistDetails = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { name, isPublic, projectName, projectDescription } = req.body;

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    if (name) wishlist.name = name;
    if (isPublic !== undefined) wishlist.isPublic = isPublic;
    if (projectName) wishlist.projectName = projectName;
    if (projectDescription) wishlist.projectDescription = projectDescription;

    await wishlist.save();

    await wishlist.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Wishlist updated",
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getPublicWishlist = async (req, res) => {
  try {
    const { userId } = req.params;

    const wishlist = await Wishlist.findOne({
      user: userId,
      isPublic: true,
    }).populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Public wishlist not found",
      });
    }

    res.status(200).json({
      success: true,
      wishlist,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export {
  getWishlist,
  addToWishlist,
  updateWishlistItem,
  removeFromWishlist,
  moveToCart,
  clearWishlist,
  updateWishlistDetails,
  getPublicWishlist,
};
