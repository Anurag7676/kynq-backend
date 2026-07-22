// models/editorModel.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const editorSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name']
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email'
      ]
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // Don't return password in queries
    },
    permissions: {
      dashboard: {
        type: Boolean,
        default: true // Everyone should see dashboard
      },
      ecommerce: {
        type: Boolean,
        default: false
      },
      cms: {
        type: Boolean,
        default: false
      },
      customers: {
        type: Boolean,
        default: false
      },
      financial: {
        type: Boolean,
        default: false
      },
      system: {
        type: Boolean,
        default: false // Usually admin only
      }
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
editorSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to check password
editorSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to check if editor has access to a section
editorSchema.methods.hasAccess = function(section) {
  return this.permissions[section] === true;
};

// Method to get accessible sections
editorSchema.methods.getAccessibleSections = function() {
  const sections = [];
  for (const [section, hasAccess] of Object.entries(this.permissions)) {
    if (hasAccess) {
      sections.push(section);
    }
  }
  return sections;
};

const Editor = mongoose.model('Editor', editorSchema);

export default Editor;