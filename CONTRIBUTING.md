# Contributing to Shardy

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the sections below for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for us maintainers and smooth out the experience for all involved. The community looks forward to your contributions. 🎉

> [!NOTE]
> And if you like the project, but just don't have time to contribute, that's fine. There are other easy ways to support the project and show your appreciation, which we would also be very happy about:
> - Star the project
> - Tweet about it
> - Refer this project in your project's readme
> - Donate in any way convenient for you
> - Mention the project at local meetups and tell your friends/colleagues

## Code of Conduct

This project and everyone participating in it is governed by the [Shardy Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to mail@mopsicus.ru.

## I have a question

Before you ask a question, it is best to search for existing [Issues](https://github.com/mopsicus/shardy/issues) that might help you. In case you have found a suitable issue and still need clarification, you can write your question in this issue. It is also advisable to search the internet for answers first.

If you then still feel the need to ask a question and need clarification, we recommend the following:

- Open an [Issue](https://github.com/mopsicus/shardy/issues/new)
- Provide as much context as you can about what you're running into
- Provide project and platform versions (nodejs, npm, etc), depending on what seems relevant

We will then take care of the issue as soon as possible.

## Types of Contributions

Thanks for taking the time to contribute, once again! Please check out the options for how you can start contributing.

> [!IMPORTANT] 
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project license.

### Create new Shardy services

Want to contribute to Shardy services ecosystem? Great! 

Create your service on Shardy, deploy it on Github, write about it to mail@mopsicus.ru with link to repo and description. All usefull services will be added to the "Hall of Fame".

You can get [Service template](https://github.com/mopsicus/shardy-template) as reference for your new services. Use `shardy-XXX` prefix for your repositories to maintain continuity and recognition for other users.

### Reporting Bugs

A good bug report shouldn’t leave others needing to chase you up for more information. Therefore, we ask you to investigate carefully, collect information and describe the issue in detail in your report. Please complete the following steps in advance to help us fix any potential bug as fast as possible:

- Make sure that you are using the latest version
- Determine if your bug is really a bug and not an error on your side e.g. using incompatible environment components/versions
- To see if other users have experienced (and potentially already solved) the same issue you are having, check if there is not already a bug report existing for your bug or error in the [bug tracker](https://github.com/mopsicus/shardy/issues?q=label%3Abug)
- Collect information about the bug:
  - Stack trace (Traceback)
  - OS, Platform and Version (Windows, Linux, macOS, x86, ARM)
  - Version of the interpreter, compiler, SDK, runtime environment, package manager, depending on what seems relevant
  - Possibly your input and the output
  - Can you reliably reproduce the issue? And can you also reproduce it with older versions?

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Shardy, including completely new features and minor improvements to existing functionality. Following these guidelines will help maintainers and the community to understand your suggestion and find related suggestions.

- Make sure that you are using the latest version
- Perform a [search](https://github.com/mopsicus/shardy/issues) to see if the enhancement has already been suggested. If it has, add a comment to the existing issue instead of opening a new one
- Enhancement suggestions are tracked as [GitHub issues](https://github.com/mopsicus/shardy/issues)
- Create new issue
- Use a **clear and descriptive title** for the issue to identify the suggestion
- Provide a **step-by-step description of the suggested enhancement** in as many details as possible
- **Explain why this enhancement would be useful** to most Shardy users. You may also want to point out the other projects that solved it better and which could serve as inspiration

### Implementing Features

Look through the [GitHub issues](https://github.com/mopsicus/shardy/issues) for features. Anything tagged with "enhancement" is open to whoever wants to implement it.

Ready to contribute? Here are the simple steps for local development:

1. [Fork](https://github.com/mopsicus/shardy/fork) the Shardy repo on GitHub
2. Clone your fork locally:
    ```
    git clone git@github.com:YOUR_USERNAME/shardy.git
    ```
3. Make sure you have the latest LTS version of Node.js installed
4. Create a branch for local development:
    ```
    git checkout -b shardy-bugfix-or-feature
    ```
5. Install dependencies:
    ```
    npm install
    ```
7. Implement what you wanted. Please make sure you add comments and stick to the existing code style
8. Build Shardy:
    ```
    npm run build
    ```
9. Make sure there are no errors or warnings after assembly
10. Please, follow the [Conventional Commits](https://www.conventionalcommits.org), when you make a commit
11. Commit your changes and push your branch to GitHub:
    ```    
    git add .
    git commit -m "feat(transport): add UDP protocol"
    git push origin shardy-bugfix-or-feature
    ```
12. Submit a [pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request) through the GitHub website
