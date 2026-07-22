
// const checkRole = (roles) => {
//   return (req, res, next) => {
//     if (!req.admin) {
//       return res.status(401).json({
//         success: false,
//         message: 'Not authenticated'
//       });
//     }

//     if (roles.includes(req.admin.role)) {
//       next();
//     } else {
//       return res.status(403).json({
//         success: false,
//         message: `Not authorized, role '${req.admin.role}' does not have permission`
//       });
//     }
//   };
// };

// const adminOnly = checkRole(['admin']);
// const editorOnly = checkRole(['editor']);
// const userOnly = checkRole(['user']);
// const adminOrEditor = checkRole(['admin', 'editor']);
// const editorOrUser = checkRole(['editor', 'user']);
// const allRoles = checkRole(['admin', 'editor', 'user']);

// export { 
//   checkRole, 
//   adminOnly, 
//   editorOnly, 
//   userOnly,
//   adminOrEditor, 
//   editorOrUser,
//   allRoles 
// };



// middleware/roleMiddleware.js (Enhanced version)

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.admin && !req.editor) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }

    let userRole;
    if (req.userType === 'admin') {
      userRole = req.admin.role;
    } else if (req.userType === 'editor') {
      userRole = 'editor';
    }

    if (roles.includes(userRole)) {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: `Not authorized, role '${userRole}' does not have permission`
      });
    }
  };
};

// Admin only access
const adminOnly = (req, res, next) => {
  if (req.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin access required.'
    });
  }
  next();
};

// Editor only access  
const editorOnly = (req, res, next) => {
  if (req.userType !== 'editor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Editor access required.'
    });
  }
  next();
};

// User only access
const userOnly = (req, res, next) => {
  if (req.userType !== 'user') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. User access required.'
    });
  }
  next();
};

// Admin or Editor access
const adminOrEditor = (req, res, next) => {
  if (req.userType !== 'admin' && req.userType !== 'editor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Editor access required.'
    });
  }
  next();
};

// Editor or User access
const editorOrUser = (req, res, next) => {
  if (req.userType !== 'editor' && req.userType !== 'user') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Editor or User access required.'
    });
  }
  next();
};

// All roles access (Admin, Editor, User)
const allRoles = (req, res, next) => {
  if (!req.userType || !['admin', 'editor', 'user'].includes(req.userType)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Authentication required.'
    });
  }
  next();
};

// Admin panel access (Admin or Editor only)
const adminPanelAccess = (req, res, next) => {
  if (req.userType !== 'admin' && req.userType !== 'editor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin panel access required.'
    });
  }
  next();
};

// Check if user is admin or editor with specific permissions
const adminOrEditorWithPermissions = (permissions) => {
  return (req, res, next) => {
    // Admin has all permissions
    if (req.userType === 'admin') {
      next();
      return;
    }

    // Editor needs specific permissions
    if (req.userType === 'editor') {
      const hasPermissions = permissions.every(permission => 
        req.editor.permissions[permission]
      );

      if (hasPermissions) {
        next();
        return;
      } else {
        const missingPermissions = permissions.filter(permission => 
          !req.editor.permissions[permission]
        );
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
      message: 'Access denied. Admin or Editor access required.'
    });
  };
};

export { 
  checkRole, 
  adminOnly, 
  editorOnly, 
  userOnly,
  adminOrEditor, 
  editorOrUser,
  allRoles,
  adminPanelAccess,
  adminOrEditorWithPermissions,
};