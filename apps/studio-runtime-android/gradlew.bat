@echo off
setlocal
set APP_HOME=%~dp0
set WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar
set WRAPPER_URL=https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar

if not exist "%WRAPPER_JAR%" (
  if not exist "%APP_HOME%gradle\wrapper" mkdir "%APP_HOME%gradle\wrapper"
  where curl >nul 2>nul
  if errorlevel 1 (
    echo gradle-wrapper.jar is missing and curl is unavailable. 1>&2
    exit /b 1
  )
  curl -fL "%WRAPPER_URL%" -o "%WRAPPER_JAR%"
  if errorlevel 1 exit /b 1
)

java %JAVA_OPTS% %GRADLE_OPTS% -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
