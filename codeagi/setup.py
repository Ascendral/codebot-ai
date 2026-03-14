from setuptools import find_packages, setup


setup(
    name="codeagi",
    version="0.1.0",
    description="Experimental autonomous cognition runtime for persistent agent research",
    author="Ascendral",
    url="https://github.com/Ascendral/codeagi",
    license="All rights reserved.",
    packages=find_packages(where="."),
    package_dir={"": "."},
    include_package_data=True,
    package_data={"codeagi": ["config/*.json"]},
    entry_points={"console_scripts": ["codeagi=codeagi.interfaces.cli:main"]},
)
