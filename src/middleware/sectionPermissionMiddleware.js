// middleware/sectionPermissionMiddleware.js

// Check if user has access to a specific section
const checkSectionAccess = (section) => {
  return (req, res, next) => {
    // Admins have access to everything
    if (req.userType === 'admin') {
      next();
      return;
    }

    // Editors need specific section permission
    if (req.userType === 'editor') {
      if (req.editor.permissions[section]) {
        next();
        return;
      } else {
        return res.status(403).json({
          success: false,
          message: `Access denied. You don't have ${section} permissions.`,
          requiredPermission: section,
          yourPermissions: req.editor.getAccessibleSections(),
        });
      }
    }

    // Regular users don't have admin panel access
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Editor access required.',
    });
  };
};

// Pre-defined section access middlewares
const ecommerceAccess = checkSectionAccess('ecommerce');
const cmsAccess = checkSectionAccess('cms');
const customersAccess = checkSectionAccess('customers');
const financialAccess = checkSectionAccess('financial');
const systemAccess = checkSectionAccess('system');
const dashboardAccess = checkSectionAccess('dashboard');

// Combined access checkers
const adminOrEditorWithSection = (section) => {
  return (req, res, next) => {
    if (req.userType === 'admin') {
      next();
      return;
    }
    
    if (req.userType === 'editor') {
      if (req.editor.permissions[section]) {
        next();
        return;
      } else {
        return res.status(403).json({
          success: false,
          message: `Access denied. You don't have ${section} permissions.`,
        });
      }
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Editor access required.',
    });
  };
};

// Multiple sections access (user needs ANY of the specified sections)
const checkAnySectionAccess = (sections) => {
  return (req, res, next) => {
    // Admins have access to everything
    if (req.userType === 'admin') {
      next();
      return;
    }

    // Editors need at least one of the specified sections
    if (req.userType === 'editor') {
      const hasAccess = sections.some(section => req.editor.permissions[section]);
      
      if (hasAccess) {
        next();
        return;
      } else {
        return res.status(403).json({
          success: false,
          message: `Access denied. You need permission for one of: ${sections.join(', ')}`,
          requiredPermissions: sections,
          yourPermissions: req.editor.getAccessibleSections(),
        });
      }
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Editor access required.',
    });
  };
};

// All sections access (user needs ALL of the specified sections)
const checkAllSectionAccess = (sections) => {
  return (req, res, next) => {
    // Admins have access to everything
    if (req.userType === 'admin') {
      next();
      return;
    }

    // Editors need all of the specified sections
    if (req.userType === 'editor') {
      const hasAllAccess = sections.every(section => req.editor.permissions[section]);
      
      if (hasAllAccess) {
        next();
        return;
      } else {
        const missingPermissions = sections.filter(section => !req.editor.permissions[section]);
        return res.status(403).json({
          success: false,
          message: `Access denied. Missing permissions: ${missingPermissions.join(', ')}`,
          missingPermissions,
          yourPermissions: req.editor.getAccessibleSections(),
        });
      }
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Editor access required.',
    });
  };
};

// Admin panel access (any admin or editor)
const adminPanelAccess = (req, res, next) => {
  // Admins and Editors both have admin panel access
  if (req.userType === 'admin' || req.userType === 'editor') {
    next();
    return;
  }

  // Regular users don't have admin panel access
  return res.status(403).json({
    success: false,
    message: 'Access denied. Admin panel access required.',
  });
};

export {
  checkSectionAccess,
  adminOrEditorWithSection,
  checkAnySectionAccess,
  checkAllSectionAccess,
  // Pre-defined section middlewares
  ecommerceAccess,
  cmsAccess,
  customersAccess,
  financialAccess,
  systemAccess,
  dashboardAccess,
  // Admin panel access
  adminPanelAccess,
};