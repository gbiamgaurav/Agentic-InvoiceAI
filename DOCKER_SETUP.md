# Docker Setup Guide - Agentic InvoiceAI

## Project Overview

**Agentic-InvoiceAI** is a Next.js 14 application with the following stack:
- **Frontend:** React 18 with Tailwind CSS and Radix UI components
- **Backend:** Next.js 14 API routes
- **Database:** MongoDB 6.6
- **Package Manager:** Yarn 1.22.22
- **Container:** Docker with Node.js 20 Alpine

## Quick Start

### Prerequisites
- Docker Desktop installed ([Download](https://www.docker.com/products/docker-desktop))
- Docker Compose (included with Docker Desktop)

### Running Locally with Docker Compose

1. **Clone/Navigate to the project:**
   ```bash
   cd /Users/gauravb/Documents/OfficeProjects/Agentic-InvoiceAI
   ```

2. **Build and start the services:**
   ```bash
   docker-compose up --build
   ```

3. **Access the application:**
   - Open your browser and go to `http://localhost:3000`
   - MongoDB will be available at `mongodb://admin:password123@localhost:27017`

4. **Stop the services:**
   ```bash
   docker-compose down
   ```

### Docker Compose Services

#### MongoDB
- **Container:** `invoice-ai-mongodb`
- **Port:** 27017
- **Default Credentials:**
  - Username: `admin`
  - Password: `password123`
  - Database: `invoiceai`
- **Data Persistence:** Volume-based (`mongodb_data`)

#### Next.js App
- **Container:** `invoice-ai-app`
- **Port:** 3000
- **Environment:** Production mode with standalone output

## Environment Variables

Configure these in `docker-compose.yml` under the `app` service:

| Variable | Purpose | Default |
|----------|---------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://admin:password123@mongodb:27017/invoiceai?authSource=admin` |
| `CORS_ORIGINS` | Allowed CORS origins | `*` (all origins) |
| `NODE_ENV` | Node.js environment | `production` |
| `HOSTNAME` | Server hostname | `0.0.0.0` |

Add any API keys or custom variables:
```yaml
environment:
  OPENAI_API_KEY: your_key_here
  API_KEY: your_api_key_here
```

## Building Docker Image Manually

If you want to build the Docker image without docker-compose:

```bash
# Build the image
docker build -t agentic-invoiceai:latest .

# Run the container
docker run -d \
  --name invoice-ai \
  -p 3000:3000 \
  -e MONGODB_URI="mongodb://your-mongodb-uri" \
  agentic-invoiceai:latest
```

## Useful Commands

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
docker-compose logs -f mongodb
```

### Access MongoDB inside container
```bash
docker-compose exec mongodb mongosh -u admin -p password123
```

### Rebuild after code changes
```bash
docker-compose up --build
```

### Remove everything (volumes and images)
```bash
docker-compose down -v
```

### Check container status
```bash
docker-compose ps
```

## Troubleshooting

### Port already in use
If port 3000 or 27017 is already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Use 3001 instead
```

### Container exiting immediately
Check logs:
```bash
docker-compose logs app
```

### MongoDB connection issues
Ensure MongoDB container is healthy:
```bash
docker-compose ps mongodb
```

Should show `healthy` status. If not, check logs:
```bash
docker-compose logs mongodb
```

## Production Considerations

For production deployment:

1. **Update environment variables:**
   - Use strong MongoDB credentials
   - Set appropriate CORS_ORIGINS
   - Add API keys securely (use secrets management)

2. **Security:**
   - Change default MongoDB username/password
   - Use environment secrets instead of plaintext
   - Enable network policies

3. **Performance:**
   - Consider using MongoDB Atlas for managed database
   - Use CDN for static assets
   - Enable caching headers

4. **Monitoring:**
   - Set up log aggregation
   - Monitor container health
   - Track resource usage

## File Structure

```
├── Dockerfile           # Multi-stage build configuration
├── docker-compose.yml   # Development environment setup
├── .dockerignore        # Files to exclude from Docker build
├── package.json         # Dependencies and scripts
├── next.config.js       # Next.js configuration
├── app/                 # Next.js app directory
├── components/          # React components
├── lib/                 # Utilities and helpers
└── DOCKER_SETUP.md      # This file
```

## Development vs Production

### Development Mode (Local)
```bash
yarn dev        # With hot reload
# or
docker-compose up
```

### Production Mode (Docker)
```bash
# Docker uses the production build with standalone output
docker-compose up --build
```

The Dockerfile uses Next.js standalone output which creates a minimal production image without the full .next folder.

## Next Steps

1. ✅ Configure environment variables with your API keys
2. ✅ Test MongoDB connection
3. ✅ Deploy to your preferred platform (AWS ECS, DigitalOcean, etc.)
4. ✅ Set up CI/CD pipeline

For more information, refer to:
- [Next.js Documentation](https://nextjs.org/docs)
- [Docker Documentation](https://docs.docker.com)
- [MongoDB Documentation](https://docs.mongodb.com)
