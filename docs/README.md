# 0studio - Desktop 3D Model Version Control

**0studio** is a macOS desktop application that transforms how you manage versions of your 3D models. Just like VSCode opens a folder as a "project", 0studio opens a .3dm file as a project and provides Git-based version control for your Rhino 3D models with cloud sync, AI-powered commits, and an interactive 3D viewer.

## 🎯 Key Features

### Core Functionality
- **File-Based Projects**: Open any .3dm file as a project
- **Auto-Detection**: Automatically detects when your .3dm file is saved in Rhino
- **Git Integration**: Full version control with commit, push, pull operations
- **Visual Timeline**: Browse through your model's history with an intuitive timeline
- **Gallery Mode**: Compare up to 4 model versions side-by-side in a grid layout
- **One File Workflow**: No need to save multiple versions manually

### 3D Visualization
- **Interactive 3D Viewer**: Three.js-based viewer with orbit controls
- **Scene Statistics**: View curves, surfaces, and polysurfaces counts
- **Model Import/Export**: Load and export .3dm files seamlessly
- **Real-time Rendering**: Smooth 3D visualization with proper lighting and materials

### Cloud & Collaboration
- **Cloud Storage**: Sync your models to AWS S3 with versioning
- **Supabase Integration**: Database-backed commit history and project management
- **Cross-Device Sync**: Access your models from any device
- **Payment Plans**: Student and Enterprise plans unlock cloud features

### AI-Powered Features
- **AI Commits**: Use natural language to describe changes - AI interprets and applies them
- **Smart Commands**: AI generates scene manipulation commands from your descriptions
- **Google Gemini Integration**: Powered by Google's Gemini AI models

### User Experience
- **macOS Native**: Built specifically for macOS with proper file associations
- **Modern UI**: Beautiful interface built with React, Tailwind CSS, and Shadcn UI
- **Authentication**: Secure user accounts via Supabase Auth
- **Payment Integration**: Stripe-powered subscription management

## 🚀 Getting Started

### Prerequisites

- **macOS 10.14 or later**
- **Node.js 18+** and npm
- **Rhino 3D** (for creating/editing .3dm files)
- **Git** (for version control)

### Quick Start

1. **Clone the repository**:
```bash
git clone <your-repo-url>
cd 0studio
```

2. **Install dependencies**:
```bash
npm install
```

3. **Set up environment variables**:
```bash
cp .env.example .env
```

Edit `.env` with your credentials (optional - only needed for cloud features):
```env
# Supabase (optional - for auth and cloud features)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Backend API (optional - for cloud storage and payments)
VITE_BACKEND_URL=http://localhost:3000
```

> **Note**: For local-only usage, no environment variables are required. The app works fully offline with local file storage.

4. **Build Electron components**:
```bash
npm run build:electron
```

5. **Run in development mode**:
```bash
npm run electron:dev
```

## 📦 Backend Setup (Cloud Storage & Payments)

The backend server handles AWS S3 operations and Stripe payment processing.

### Backend Requirements

1. **Set up AWS S3** (see [AWS_SETUP.md](./AWS_SETUP.md)):
   - Create S3 bucket with versioning enabled
   - Create IAM user with S3 permissions
   - Get AWS credentials

2. **Set up Supabase** (see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)):
   - Create Supabase project
   - Set up database tables (projects, commits, branches, subscriptions)
   - Get Supabase URL and keys

3. **Set up Stripe** (see [STRIPE_SETUP.md](./STRIPE_SETUP.md)):
   - Create Stripe account
   - Create products and prices for Student/Enterprise plans
   - Get Stripe API keys
   - Configure webhook endpoint

### Backend Configuration

1. **Navigate to backend directory**:
```bash
cd backend
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# AWS S3
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret

# Server
PORT=3000
FRONTEND_URL=http://localhost:5173
```

4. **Test backend setup**:
```bash
node test-setup.js
```

5. **Start backend server**:
```bash
npm run dev
```

For local Stripe webhook testing:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

See [BACKEND_SETUP_COMPLETE.md](./BACKEND_SETUP_COMPLETE.md) for detailed setup instructions.

## 🏗️ Building for Distribution

### Development Build

```bash
# Build React app
npm run build

# Build Electron
npm run build:electron

# Run Electron app
npm run electron:dev
```

### Production Build

```bash
# Build everything
npm run build
npm run build:electron

# Package for macOS
npm run electron:dist
```

This creates a `.dmg` installer in the `dist-electron` folder.

## 📖 How to Use

### Opening a Project

1. **Launch 0studio**
2. **Click "Open .3dm Project"** or use `Cmd+O`
3. **Select your .3dm file** - this becomes your project
4. The model loads automatically in the 3D viewer

### Version Control Workflow

1. **Work on Your Model**:
   - Open your .3dm file in Rhino
   - Make changes to your model
   - Save in Rhino (0studio automatically detects changes)

2. **Commit Changes**:
   - Return to 0studio
   - You'll see your changes in the "Version History" section
   - Enter a commit message describing your changes
   - Click "Save Version" to commit

3. **Browse History**:
   - View all commits in the "Version History" section
   - Click any commit to restore that version
   - Use the timeline to navigate through history

4. **Gallery Mode**:
   - Click the "Gallery" button to enter gallery mode
   - Select up to 4 commits to compare side-by-side
   - View layouts:
     - **2 models**: Side by side
     - **3 models**: 2 on top, 1 full-width on bottom
     - **4 models**: 2x2 grid

5. **Cloud Sync** (requires subscription):
   - Commits are automatically synced to cloud storage
   - Use "Pull from Cloud" to sync from other devices
   - Requires active Student or Enterprise plan

### AI-Powered Commits

1. **Enter a natural language description** of the changes you want
2. **AI interprets** your message and generates scene commands
3. **Commands are executed** automatically on your model
4. **Commit is created** with the updated model

Example: "Add a red sphere in the center" or "Scale all objects by 1.5x"

### File Watching

0studio automatically watches your .3dm file for changes:
- When you save in Rhino, changes appear immediately in 0studio
- No need to manually refresh or reload
- Supports background file monitoring with stability detection

### Payment Plans

Access cloud features with a subscription:

1. **Sign in** to your account
2. **Click your email** in the title bar
3. **Select "Dashboard"** from the menu
4. **Choose a plan**:
   - **Student Plan**: Affordable pricing for students
   - **Enterprise Plan**: Full features for professionals
5. **Complete payment** via Stripe Checkout
6. **Unlock cloud features** immediately

## 🛠️ Development

### Project Structure

```
0studio/
├── electron/              # Electron main process
│   ├── main.ts           # Main entry point
│   ├── preload.ts        # Context bridge
│   └── services/         # File watching, Git, Project services
├── src/                  # React application
│   ├── components/       # UI components
│   ├── contexts/        # State management (Model, VersionControl, Auth)
│   ├── lib/             # Services (desktop-api, gemini, rhino3dm, etc.)
│   ├── pages/           # Page components
│   └── hooks/           # Custom React hooks
├── backend/             # Backend API server
│   ├── server.js        # Express server
│   └── test-setup.js    # Setup verification
└── dist/                # Built files
```

### Available Scripts

- `npm run dev` - Start Vite dev server
- `npm run build` - Build React app for production
- `npm run build:electron` - Build Electron TypeScript
- `npm run watch:electron` - Watch Electron changes
- `npm run electron:dev` - Run Electron app in dev mode
- `npm run electron:dist` - Package for distribution

### Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **3D Rendering**: Three.js, React Three Fiber, rhino3dm
- **Desktop**: Electron 32
- **Cloud**: Supabase (Auth + Database), AWS S3 (Storage)
- **Payments**: Stripe
- **AI**: Google Gemini API
- **UI Components**: Shadcn UI (Radix UI primitives)

## 📚 Documentation

- [PRD_CONTEXT.md](./PRD_CONTEXT.md) - Comprehensive system architecture and development guide
- [AWS_SETUP.md](./AWS_SETUP.md) - AWS S3 setup instructions
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) - Supabase configuration guide
- [STRIPE_SETUP.md](./STRIPE_SETUP.md) - Stripe payment integration setup
- [BACKEND_SETUP_COMPLETE.md](./BACKEND_SETUP_COMPLETE.md) - Complete backend setup guide
- [backend/README.md](./backend/README.md) - Backend API documentation

## 🤝 Contributing

This is a private project. For contributions, please contact the maintainers.

## 📄 License

Private - All rights reserved

## 🆘 Support

For issues and questions:
1. Check the documentation files listed above
2. Review [PRD_CONTEXT.md](./PRD_CONTEXT.md) for technical details
3. Check backend logs for API issues
4. Verify environment variables are set correctly

---

**0studio** - Version control for 3D models, reimagined.
