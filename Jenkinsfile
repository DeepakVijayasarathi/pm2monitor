pipeline {
    agent any

    environment {
        IMAGE_NAME     = "pm2-monitor"
        CONTAINER_NAME = "pm2-monitor-container"
        HOST_PORT      = "5004"
        REPO_URL       = "https://github.com/your-username/pm2-monitor.git"
        BRANCH         = "main"
    }

    stages {

        stage('Clean Workspace') {
            steps {
                deleteDir()
            }
        }

        stage('Clone Code') {
            steps {
                git branch: "${BRANCH}",
                    url: "${REPO_URL}",
                    credentialsId: 'your-credentials-id'
            }
        }

        stage('Verify Structure') {
            steps {
                sh 'ls -la'
                sh 'ls -la frontend backend'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh 'docker build --no-cache -t $IMAGE_NAME .'
            }
        }

        stage('Stop Old Container') {
            steps {
                sh '''
                docker stop $CONTAINER_NAME || true
                docker rm   $CONTAINER_NAME || true
                '''
            }
        }

        stage('Run New Container') {
            steps {
                sh '''
                docker run -d \
                  --name $CONTAINER_NAME \
                  --restart=always \
                  -p $HOST_PORT:$HOST_PORT \
                  -v /root/.pm2:/root/.pm2 \
                  $IMAGE_NAME
                '''
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                sleep 8
                docker ps | grep $CONTAINER_NAME
                docker logs $CONTAINER_NAME --tail 30
                '''
            }
        }

        stage('Cleanup') {
            steps {
                sh 'docker image prune -f'
            }
        }
    }

    post {
        success {
            sh '''
            IP=$(hostname -I | awk '{print $1}')
            echo "✅ PM2 Monitor deployed at http://$IP:${HOST_PORT}"
            '''
        }
        failure {
            echo "❌ Deployment failed — check logs above"
            sh 'docker logs $CONTAINER_NAME --tail 50 || true'
        }
    }
}
